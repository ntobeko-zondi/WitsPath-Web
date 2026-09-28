package com.example.witspath.routing.service;

import com.example.witspath.routing.CampusGraph;
import com.example.witspath.routing.Edge;
import com.example.witspath.routing.Node;
import com.example.witspath.routing.PathFinder;
import com.example.witspath.routing.RouteOptions;
import com.example.witspath.routing.TravelTimeEstimator;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Executors;

/**
 * WitsPath routing service: runs the shared A* (routing core) over HTTP so
 * the website uses exactly the same engine as the Android app.
 *
 * Stateless: every request carries the graph snapshot (the caller reads it
 * from Firestore, including live edge statuses), so the service has no
 * database access and no credentials.
 *
 *   GET  /health     -> {"status":"ok"}
 *   POST /v1/route   body: {graph:{floors,nodes,edges}, from_node_id, to_node_id,
 *                           accessible, speed_multiplier?, mobility_profile?,
 *                           prefer_lifts?, avoid_steep_ramps?}
 *     200 {path:[nodeId...], edge_ids:[...], distance_m, accessible, estimated_seconds,
 *          blocked_segments:[], engine}
 *     422 {error:"no_route", message}   400 {error:"bad_request", message}
 *
 * PORT comes from the environment (Cloud Run sets it); default 8081.
 */
public final class RoutingServer
{
    static final String ENGINE = "witspath-routing-core/1.0";
    private static final int MAX_BODY_BYTES = 2 * 1024 * 1024;

    private RoutingServer()
    {
    }

    public static void main(String[] args) throws IOException
    {
        int port = Integer.parseInt(System.getenv().getOrDefault("PORT", "8081"));
        HttpServer server = HttpServer.create(new InetSocketAddress(port), 0);
        server.createContext("/health", exchange -> {
            if (!"GET".equals(exchange.getRequestMethod()))
            {
                send(exchange, 405, error("method_not_allowed", "Use GET."));
                return;
            }
            Map<String, Object> ok = new LinkedHashMap<>();
            ok.put("status", "ok");
            ok.put("engine", ENGINE);
            send(exchange, 200, ok);
        });
        server.createContext("/v1/route", RoutingServer::handleRoute);
        server.setExecutor(Executors.newFixedThreadPool(Math.max(2, Runtime.getRuntime().availableProcessors() * 2)));
        server.start();
        System.out.println("WitsPath routing service (" + ENGINE + ") listening on port " + port);
    }

    private static void handleRoute(HttpExchange exchange) throws IOException
    {
        try
        {
            if (!"POST".equals(exchange.getRequestMethod()))
            {
                send(exchange, 405, error("method_not_allowed", "Use POST."));
                return;
            }
            String body = readBody(exchange.getRequestBody());
            Object parsed = Json.parse(body);
            if (!(parsed instanceof Map))
            {
                send(exchange, 400, error("bad_request", "Body must be a JSON object."));
                return;
            }
            @SuppressWarnings("unchecked")
            Map<String, Object> request = (Map<String, Object>) parsed;
            Result result = route(request);
            send(exchange, result.status, result.body);
        }
        catch (IllegalArgumentException e)
        {
            send(exchange, 400, error("bad_request", e.getMessage()));
        }
        catch (RuntimeException e)
        {
            send(exchange, 500, error("internal_error", "Routing failed."));
        }
    }

    static final class Result
    {
        final int status;
        final Map<String, Object> body;

        Result(int status, Map<String, Object> body)
        {
            this.status = status;
            this.body = body;
        }
    }

    /** The request -> response logic, separate from HTTP so it can be tested directly. */
    @SuppressWarnings("unchecked")
    static Result route(Map<String, Object> request)
    {
        Object graphJson = request.get("graph");
        if (!(graphJson instanceof Map))
        {
            return new Result(400, error("bad_request", "Missing graph."));
        }
        CampusGraph graph = CampusGraph.fromMap((Map<String, Object>) graphJson);

        Node from = graph.node(stringField(request, "from_node_id"));
        Node to = graph.node(stringField(request, "to_node_id"));
        if (from == null || to == null)
        {
            return new Result(400, error("unknown_place", "from_node_id and to_node_id must be nodes in the graph."));
        }
        double multiplier = 1.0;
        Object m = request.get("speed_multiplier");
        if (m instanceof Number)
        {
            multiplier = Math.min(2.0, Math.max(0.3, ((Number) m).doubleValue()));
        }
        Object profile = request.get("mobility_profile");
        if (profile != null && !(profile instanceof String && RouteOptions.isKnown((String) profile)))
        {
            return new Result(400, error("bad_request", "mobility_profile must be none, wheelchair, walking_aid or low_vision."));
        }
        RouteOptions options = new RouteOptions(
                profile == null ? RouteOptions.NONE : (String) profile,
                Boolean.TRUE.equals(request.get("accessible")),
                Boolean.TRUE.equals(request.get("prefer_lifts")),
                Boolean.TRUE.equals(request.get("avoid_steep_ramps")));

        PathFinder finder = new PathFinder();
        LinkedList<Node> path = finder.aStarSearch(from, to, options);
        if (path == null)
        {
            return new Result(422, error(from == to ? "same_place" : "no_route", finder.getErrorMessage()));
        }

        List<Object> nodeIds = new ArrayList<>();
        List<Object> edgeIds = new ArrayList<>();
        double distance = 0;
        boolean stepFree = true;
        for (int i = 0; i < path.size(); i++)
        {
            nodeIds.add(path.get(i).nodeId);
            if (i > 0)
            {
                Edge edge = CampusGraph.edgeBetween(path.get(i - 1), path.get(i));
                edgeIds.add(edge.edgeId);
                distance += edge.distance;
                stepFree = stepFree && edge.isStepFree();
            }
        }

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("path", nodeIds);
        body.put("edge_ids", edgeIds);
        body.put("distance_m", Math.round(distance * 10) / 10.0);
        body.put("accessible", stepFree);
        body.put("estimated_seconds", Math.round(new TravelTimeEstimator(multiplier, options.mobilityProfile).estimateTime(path)));
        body.put("blocked_segments", new ArrayList<>());
        body.put("engine", ENGINE);
        return new Result(200, body);
    }

    private static String stringField(Map<String, Object> m, String key)
    {
        Object value = m.get(key);
        return value instanceof String ? (String) value : "";
    }

    static Map<String, Object> error(String code, String message)
    {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("error", code);
        body.put("message", message);
        return body;
    }

    private static String readBody(InputStream in) throws IOException
    {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int total = 0;
        int read;
        while ((read = in.read(buffer)) != -1)
        {
            total += read;
            if (total > MAX_BODY_BYTES)
            {
                throw new IllegalArgumentException("Request too large.");
            }
            out.write(buffer, 0, read);
        }
        return new String(out.toByteArray(), StandardCharsets.UTF_8);
    }

    private static void send(HttpExchange exchange, int status, Map<String, Object> body) throws IOException
    {
        byte[] bytes = Json.write(body).getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
        exchange.sendResponseHeaders(status, bytes.length);
        try (OutputStream out = exchange.getResponseBody())
        {
            out.write(bytes);
        }
    }
}
