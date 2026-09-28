package com.example.witspath.routing;

import java.util.ArrayList;
import java.util.List;

/**
 * A place or junction in the campus graph.
 *
 * Differs from the Android app's Node in one way: nodes are owned by a
 * CampusGraph instance instead of static maps, so several graphs (and several
 * concurrent requests) can exist at once. {@code index} replaces the Android
 * global counter as the A* tie-breaker; it is the node's position in the
 * graph's load order, which matches the Android ids when loaded from the same
 * JSON.
 */
public class Node
{
    public final int index;
    public final String nodeId;
    public final String label;
    public final String type;
    public final String floorId;
    public final String bssid;
    public final Point point;
    public final List<Edge> edges = new ArrayList<>();

    public Node(int index, String nodeId, String label, String type, String floorId, String bssid, Point point)
    {
        this.index = index;
        this.nodeId = nodeId;
        this.label = label;
        this.type = type;
        this.floorId = floorId;
        this.bssid = bssid;
        this.point = point;
    }

    public Node other(Edge e)
    {
        if (e.node1 == this)
        {
            return e.node2;
        }
        if (e.node2 == this)
        {
            return e.node1;
        }
        return null;
    }

    public String displayName()
    {
        return label != null && !label.trim().isEmpty() ? label.trim() : nodeId;
    }
}
