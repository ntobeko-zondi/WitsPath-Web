package com.example.witspath.routing.service;

import com.example.witspath.routing.CampusGraph;
import com.example.witspath.routing.Node;
import com.example.witspath.routing.PathFinder;
import com.example.witspath.routing.TravelTimeConfig;
import com.example.witspath.routing.TravelTimeEstimator;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Plain-Java test runner (no JUnit needed): java RoutingTests <path-to-graph.json>
 * Exits non-zero on any failure.
 */
public final class RoutingTests
{
    private static int passed = 0;
    private static final List<String> failures = new ArrayList<>();
    private static String campusJson;

    public static void main(String[] args) throws Exception
    {
        campusJson = new String(Files.readAllBytes(Paths.get(args[0])), StandardCharsets.UTF_8);

        // Ported from the Android app's TravelTimeEstimatorTest (same expected values).
        test("travel time: flat route", RoutingTests::flatRoute);
        test("travel time: uphill route", RoutingTests::uphillRoute);
        test("travel time: downhill route", RoutingTests::downhillRoute);
        test("travel time: floor change via stairs", RoutingTests::floorChangeStairs);
        test("travel time: speed multiplier", RoutingTests::speedMultiplier);

        test("A*: direct edge on the real campus graph", RoutingTests::directEdge);
        test("A*: multi-hop route is the shortest", RoutingTests::multiHopShortest);
        test("A*: accessible mode avoids stairs-only edges", RoutingTests::avoidsStairs);
        test("A*: stairs with a ramp stay usable", RoutingTests::stairsWithRamp);
        test("A*: impassable cost blocks step-free routing only", RoutingTests::impassableCost);
        test("A*: flagged and blocked edges are skipped", RoutingTests::flaggedSkipped);
        test("A*: no route gives the Android error message", RoutingTests::noRoute);
        test("A*: same start and destination", RoutingTests::samePlace);

        test("service: route response shape", RoutingTests::serviceResponse);
        test("service: rejects unknown nodes and bad graphs", RoutingTests::serviceRejects);
        test("graph: nodes on unknown floors are rejected", RoutingTests::unknownFloor);
        test("json: round trip and strictness", RoutingTests::jsonRoundTrip);

        System.out.println(passed + " passed, " + failures.size() + " failed");
        for (String failure : failures)
        {
            System.out.println("FAIL " + failure);
        }
        System.exit(failures.isEmpty() ? 0 : 1);
    }

    interface Check
    {
        void run() throws Exception;
    }

    private static void test(String name, Check check)
    {
        try
        {
            check.run();
            passed++;
            System.out.println("ok   " + name);
        }
        catch (Throwable t)
        {
            failures.add(name + ": " + t.getMessage());
            System.out.println("FAIL " + name + ": " + t.getMessage());
        }
    }

    private static void check(boolean condition, String message)
    {
        if (!condition)
        {
            throw new AssertionError(message);
        }
    }

    private static void close(double expected, double actual, String what)
    {
        check(Math.abs(expected - actual) < 0.001, what + ": expected " + expected + " but was " + actual);
    }

    // ---- fixtures ------------------------------------------------------------

    @SuppressWarnings("unchecked")
    private static CampusGraph campus()
    {
        return CampusGraph.fromMap((Map<String, Object>) Json.parse(campusJson));
    }

    /** A tiny graph: 1 metre per pixel, nodes on a line 100 m apart. */
    private static Map<String, Object> lineGraph(String extraEdges)
    {
        String json = "{\"floors\":[{\"floorId\":\"f1\",\"metresPerPixel\":1},{\"floorId\":\"f2\",\"metresPerPixel\":1}],"
                + "\"nodes\":["
                + "{\"nodeId\":\"A\",\"floorId\":\"f1\",\"x\":0,\"y\":0},"
                + "{\"nodeId\":\"B\",\"floorId\":\"f1\",\"x\":100,\"y\":0},"
                + "{\"nodeId\":\"C\",\"floorId\":\"f2\",\"x\":100,\"y\":0},"
                + "{\"nodeId\":\"D\",\"floorId\":\"f1\",\"x\":200,\"y\":0}],"
                + "\"edges\":[" + extraEdges + "]}";
        @SuppressWarnings("unchecked")
        Map<String, Object> map = (Map<String, Object>) Json.parse(json);
        return map;
    }

    private static CampusGraph line(String edges)
    {
        return CampusGraph.fromMap(lineGraph(edges));
    }

    private static List<String> ids(List<Node> path)
    {
        List<String> result = new ArrayList<>();
        for (Node node : path)
        {
            result.add(node.nodeId);
        }
        return result;
    }

    // ---- travel time -------------------------------------------------------------

    private static void flatRoute()
    {
        CampusGraph g = line("{\"edgeId\":\"ab\",\"fromNodeId\":\"A\",\"toNodeId\":\"B\",\"distance\":100}");
        double expected = TravelTimeConfig.OVERHEAD_SECONDS + (100.0 / TravelTimeConfig.DEFAULT_SPEED_MPS);
        close(expected, new TravelTimeEstimator(1.0).estimateTime(Arrays.asList(g.node("A"), g.node("B"))), "flat");
    }

    private static void uphillRoute()
    {
        CampusGraph g = line("{\"edgeId\":\"ab\",\"fromNodeId\":\"A\",\"toNodeId\":\"B\",\"distance\":100,\"uphillFrom\":\"A\"}");
        double expected = TravelTimeConfig.OVERHEAD_SECONDS
                + (100.0 * TravelTimeConfig.UPHILL_FACTOR / TravelTimeConfig.DEFAULT_SPEED_MPS);
        close(expected, new TravelTimeEstimator(1.0).estimateTime(Arrays.asList(g.node("A"), g.node("B"))), "uphill");
    }

    private static void downhillRoute()
    {
        CampusGraph g = line("{\"edgeId\":\"ab\",\"fromNodeId\":\"A\",\"toNodeId\":\"B\",\"distance\":100,\"uphillFrom\":\"A\"}");
        double expected = TravelTimeConfig.OVERHEAD_SECONDS + (100.0 / TravelTimeConfig.DEFAULT_SPEED_MPS);
        close(expected, new TravelTimeEstimator(1.0).estimateTime(Arrays.asList(g.node("B"), g.node("A"))), "downhill");
    }

    private static void floorChangeStairs()
    {
        CampusGraph g = line("{\"edgeId\":\"bc\",\"fromNodeId\":\"B\",\"toNodeId\":\"C\",\"distance\":10,\"stairs\":true}");
        double expected = TravelTimeConfig.OVERHEAD_SECONDS + (10.0 / TravelTimeConfig.DEFAULT_SPEED_MPS)
                + TravelTimeConfig.STAIRS_PENALTY_SECONDS;
        close(expected, new TravelTimeEstimator(1.0).estimateTime(Arrays.asList(g.node("B"), g.node("C"))), "stairs");
    }

    private static void speedMultiplier()
    {
        CampusGraph g = line("{\"edgeId\":\"ab\",\"fromNodeId\":\"A\",\"toNodeId\":\"B\",\"distance\":100}");
        double expected = TravelTimeConfig.OVERHEAD_SECONDS + (100.0 / (TravelTimeConfig.DEFAULT_SPEED_MPS * 0.5));
        close(expected, new TravelTimeEstimator(0.5).estimateTime(Arrays.asList(g.node("A"), g.node("B"))), "0.5x");
    }

    // ---- A* ---------------------------------------------------------------------------

    private static void directEdge()
    {
        CampusGraph g = campus();
        List<Node> path = new PathFinder().aStarSearch(g.node("nd_mu84hhsut"), g.node("nd_mu842rrrm"), true);
        check(Arrays.asList("nd_mu84hhsut", "nd_mu842rrrm").equals(ids(path)), "got " + ids(path));
    }

    private static void multiHopShortest()
    {
        // Commerce Library -> School of Business Sciences. Candidates in the graph:
        // via Commerce Library Ramp + Tower of Light (16.32+20.76+33.51 = 70.59)
        // via the ramp directly (16.32+52.03 = 68.35) - the shortest.
        CampusGraph g = campus();
        List<Node> path = new PathFinder().aStarSearch(g.node("nd_mu83zm0ga"), g.node("nd_mu842ho1e"), true);
        check(Arrays.asList("nd_mu83zm0ga", "nd_mu84lizxy", "nd_mu842ho1e").equals(ids(path)), "got " + ids(path));
    }

    private static void avoidsStairs()
    {
        CampusGraph g = line(
                "{\"edgeId\":\"ad\",\"fromNodeId\":\"A\",\"toNodeId\":\"D\",\"distance\":200,\"stairs\":true},"
                + "{\"edgeId\":\"ab\",\"fromNodeId\":\"A\",\"toNodeId\":\"B\",\"distance\":150},"
                + "{\"edgeId\":\"bd\",\"fromNodeId\":\"B\",\"toNodeId\":\"D\",\"distance\":150}");
        check(Arrays.asList("A", "D").equals(ids(new PathFinder().aStarSearch(g.node("A"), g.node("D"), false))), "any route");
        check(Arrays.asList("A", "B", "D").equals(ids(new PathFinder().aStarSearch(g.node("A"), g.node("D"), true))), "step-free");
    }

    private static void stairsWithRamp()
    {
        CampusGraph g = line("{\"edgeId\":\"ad\",\"fromNodeId\":\"A\",\"toNodeId\":\"D\",\"distance\":200,\"stairs\":true,\"ramp\":true}");
        check(new PathFinder().aStarSearch(g.node("A"), g.node("D"), true) != null, "ramp alongside stairs is step-free");
    }

    private static void impassableCost()
    {
        CampusGraph g = line("{\"edgeId\":\"ad\",\"fromNodeId\":\"A\",\"toNodeId\":\"D\",\"distance\":200,\"accessibilityCost\":999}");
        check(new PathFinder().aStarSearch(g.node("A"), g.node("D"), false) != null, "usable when stairs are fine");
        check(new PathFinder().aStarSearch(g.node("A"), g.node("D"), true) == null, "impassable step-free");
    }

    private static void flaggedSkipped()
    {
        CampusGraph g = line(
                "{\"edgeId\":\"ad\",\"fromNodeId\":\"A\",\"toNodeId\":\"D\",\"distance\":200,\"status\":\"flagged\"},"
                + "{\"edgeId\":\"ab\",\"fromNodeId\":\"A\",\"toNodeId\":\"B\",\"distance\":150,\"status\":\"blocked\"}");
        check(new PathFinder().aStarSearch(g.node("A"), g.node("D"), false) == null, "flagged edge skipped");
        check(new PathFinder().aStarSearch(g.node("A"), g.node("B"), false) == null, "blocked edge skipped");
    }

    private static void noRoute()
    {
        CampusGraph g = line("{\"edgeId\":\"ab\",\"fromNodeId\":\"A\",\"toNodeId\":\"B\",\"distance\":100}");
        PathFinder finder = new PathFinder();
        check(finder.aStarSearch(g.node("A"), g.node("D"), true) == null, "no route");
        check(finder.getErrorMessage().startsWith("Failed to find an accessible route"), finder.getErrorMessage());
    }

    private static void samePlace()
    {
        CampusGraph g = campus();
        check(new PathFinder().aStarSearch(g.node("nd_mu842mili"), g.node("nd_mu842mili"), true) == null, "same place");
    }

    // ---- service -----------------------------------------------------------------------------

    private static Map<String, Object> request(Object graph, String from, String to, boolean accessible)
    {
        Map<String, Object> request = new LinkedHashMap<>();
        request.put("graph", graph);
        request.put("from_node_id", from);
        request.put("to_node_id", to);
        request.put("accessible", accessible);
        return request;
    }

    private static void serviceResponse()
    {
        RoutingServer.Result result = RoutingServer.route(
                request(Json.parse(campusJson), "nd_mu84hhsut", "nd_mu842rrrm", true));
        check(result.status == 200, "status " + result.status);
        check(Arrays.asList("nd_mu84hhsut", "nd_mu842rrrm").equals(result.body.get("path")), "path");
        check(Arrays.asList("eg_mu84s1hg1n").equals(result.body.get("edge_ids")), "edge ids");
        close(82.0, ((Number) result.body.get("distance_m")).doubleValue(), "distance");
        check(Boolean.TRUE.equals(result.body.get("accessible")), "accessible");
        // 30 s overhead + 82.01 m / 1.4 m/s = 88.6 s
        check(((Number) result.body.get("estimated_seconds")).longValue() == 89L, "seconds " + result.body.get("estimated_seconds"));
    }

    private static void serviceRejects()
    {
        RoutingServer.Result unknown = RoutingServer.route(request(Json.parse(campusJson), "nope", "nd_mu842rrrm", true));
        check(unknown.status == 400 && "unknown_place".equals(unknown.body.get("error")), "unknown node");
        RoutingServer.Result noGraph = RoutingServer.route(request(null, "a", "b", true));
        check(noGraph.status == 400, "missing graph");
        RoutingServer.Result noRoute = RoutingServer.route(request(lineGraph(""), "A", "D", true));
        check(noRoute.status == 422 && "no_route".equals(noRoute.body.get("error")), "no route");
    }

    private static void unknownFloor()
    {
        @SuppressWarnings("unchecked")
        Map<String, Object> g = (Map<String, Object>) Json.parse(
                "{\"floors\":[],\"nodes\":[{\"nodeId\":\"A\",\"floorId\":\"missing\",\"x\":1,\"y\":1}],\"edges\":[]}");
        try
        {
            CampusGraph.fromMap(g);
            throw new AssertionError("expected rejection");
        }
        catch (IllegalArgumentException expected)
        {
            check(expected.getMessage().contains("unknown floor"), expected.getMessage());
        }
    }

    private static void jsonRoundTrip()
    {
        Object value = Json.parse("{\"a\":[1,2.5,-3e2,true,false,null],\"s\":\"q\\\"\\u00e9\\n\"}");
        check("{\"a\":[1,2.5,-300,true,false,null],\"s\":\"q\\\"é\\n\"}".equals(Json.write(value)), Json.write(value));
        for (String bad : new String[] {"{", "[1,]", "{\"a\":1} x", "\"unterminated", "{\"a\" 1}"})
        {
            try
            {
                Json.parse(bad);
                throw new AssertionError("accepted " + bad);
            }
            catch (IllegalArgumentException expected)
            {
                // good
            }
        }
    }
}
