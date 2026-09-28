package com.example.witspath.routing;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * A loaded campus graph. Built from the same JSON shape the Android app ships
 * in assets/graph_data.json and stores in Firestore (floors[], nodes[], edges[]).
 *
 * Loads from plain Maps/Lists so the core has no JSON library dependency:
 * Android can adapt org.json objects, the routing service uses its own parser.
 */
public class CampusGraph
{
    private final Map<String, Floor> floors = new LinkedHashMap<>();
    private final Map<String, Node> nodes = new LinkedHashMap<>();
    private final Map<String, Edge> edges = new LinkedHashMap<>();
    private final List<String> warnings = new ArrayList<>();

    /**
     * @throws IllegalArgumentException if the data is unusable (a node on an
     *         unknown floor, a missing id or coordinate). Unlike the Android
     *         loader, pixel coordinates are never used as metres by accident.
     */
    @SuppressWarnings("unchecked")
    public static CampusGraph fromMap(Map<String, Object> root)
    {
        CampusGraph graph = new CampusGraph();

        for (Object item : list(root.get("floors")))
        {
            Map<String, Object> f = (Map<String, Object>) item;
            String floorId = requireString(f, "floorId");
            graph.floors.put(floorId, new Floor(
                    floorId,
                    string(f, "name", ""),
                    (int) number(f, "level", 0),
                    (int) number(f, "imageWidth", 0),
                    (int) number(f, "imageHeight", 0),
                    number(f, "metresPerPixel", 1.0)));
        }

        int index = 0;
        for (Object item : list(root.get("nodes")))
        {
            Map<String, Object> n = (Map<String, Object>) item;
            String nodeId = requireString(n, "nodeId");
            String floorId = string(n, "floorId", null);
            Floor floor = floorId == null ? null : graph.floors.get(floorId);
            if (floor == null)
            {
                throw new IllegalArgumentException("Node " + nodeId + " is on unknown floor " + floorId);
            }
            double x = floor.pixelsToMetres(requireNumber(n, "x", nodeId));
            double y = floor.pixelsToMetres(requireNumber(n, "y", nodeId));
            index++;
            graph.nodes.put(nodeId, new Node(index, nodeId, string(n, "label", nodeId), string(n, "type", "node"),
                    floorId, string(n, "bssid", ""), new Point(x, y)));
        }

        int edgeIndex = 0;
        for (Object item : list(root.get("edges")))
        {
            Map<String, Object> e = (Map<String, Object>) item;
            String edgeId = string(e, "edgeId", "edge_" + edgeIndex);
            edgeIndex++;
            Node from = graph.nodes.get(string(e, "fromNodeId", ""));
            Node to = graph.nodes.get(string(e, "toNodeId", ""));
            if (from == null || to == null)
            {
                // Same as Android: skip, but keep a record instead of printing.
                graph.warnings.add("Edge " + edgeId + " references an unknown node");
                continue;
            }
            Edge edge = new Edge(
                    edgeId, from, to,
                    requireNumber(e, "distance", edgeId),
                    number(e, "accessibilityCost", 1.0),
                    bool(e, "ramp"), bool(e, "stairs"), bool(e, "elevator") || bool(e, "lift"),
                    string(e, "status", "ok"),
                    string(e, "label", ""),
                    string(e, "uphillFrom", null));
            readProfileData(edge, e);
            graph.edges.put(edgeId, edge);
        }

        return graph;
    }

    public Node node(String nodeId)
    {
        return nodes.get(nodeId);
    }

    public Edge edge(String edgeId)
    {
        return edges.get(edgeId);
    }

    public Floor floor(String floorId)
    {
        return floors.get(floorId);
    }

    public Collection<Node> nodes()
    {
        return Collections.unmodifiableCollection(nodes.values());
    }

    public List<String> warnings()
    {
        return Collections.unmodifiableList(warnings);
    }

    /** The edge joining two adjacent nodes, or null. */
    public static Edge edgeBetween(Node a, Node b)
    {
        for (Edge e : a.edges)
        {
            if (a.other(e) == b)
            {
                return e;
            }
        }
        return null;
    }

    /**
     * Optional per-profile data (field names from the website team's planner):
     *   accessibilityCosts (or accessibilityCostByProfile): { wheelchair, walkingAid, lowVision, noPreference }
     *   steepRamp: true (or steep: true, or rampGrade: "steep")
     *   inaccessibleFor: ["wheelchair", "walking_aid", ...]
     */
    @SuppressWarnings("unchecked")
    private static void readProfileData(Edge edge, Map<String, Object> e)
    {
        Object costs = e.containsKey("accessibilityCosts") ? e.get("accessibilityCosts") : e.get("accessibilityCostByProfile");
        if (costs instanceof Map)
        {
            for (Map.Entry<String, Object> entry : ((Map<String, Object>) costs).entrySet())
            {
                if (entry.getValue() instanceof Number)
                {
                    edge.profileCosts.put(entry.getKey(), ((Number) entry.getValue()).doubleValue());
                }
            }
        }
        edge.steepRamp = bool(e, "steepRamp") || bool(e, "steep") || "steep".equals(e.get("rampGrade"));
        for (Object profile : list(e.get("inaccessibleFor")))
        {
            if (profile instanceof String)
            {
                // Accept the website team's hyphenated ids too.
                String id = ((String) profile).replace('-', '_');
                edge.inaccessibleFor.add("no_preference".equals(id) ? RouteOptions.NONE : id);
            }
        }
    }

    // ---- helpers -----------------------------------------------------------

    private static List<Object> list(Object value)
    {
        if (value == null)
        {
            return Collections.emptyList();
        }
        if (!(value instanceof List))
        {
            throw new IllegalArgumentException("Expected a list");
        }
        @SuppressWarnings("unchecked")
        List<Object> result = (List<Object>) value;
        return result;
    }

    private static String string(Map<String, Object> m, String key, String fallback)
    {
        Object value = m.get(key);
        return value instanceof String ? (String) value : fallback;
    }

    private static String requireString(Map<String, Object> m, String key)
    {
        String value = string(m, key, null);
        if (value == null || value.isEmpty())
        {
            throw new IllegalArgumentException("Missing " + key);
        }
        return value;
    }

    private static double number(Map<String, Object> m, String key, double fallback)
    {
        Object value = m.get(key);
        return value instanceof Number ? ((Number) value).doubleValue() : fallback;
    }

    private static double requireNumber(Map<String, Object> m, String key, String owner)
    {
        Object value = m.get(key);
        if (!(value instanceof Number) || !Double.isFinite(((Number) value).doubleValue()))
        {
            throw new IllegalArgumentException("Missing " + key + " on " + owner);
        }
        return ((Number) value).doubleValue();
    }

    private static boolean bool(Map<String, Object> m, String key)
    {
        return Boolean.TRUE.equals(m.get(key));
    }
}
