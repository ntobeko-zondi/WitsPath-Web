package com.example.witspath.routing;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.PriorityQueue;
import java.util.Set;

/**
 * A* search over the campus graph - the WitsPath routing source of truth,
 * shared by the Android app and the website's routing service.
 *
 * Extracted from the Android app's model/PathFinder.java with the same
 * algorithm: cost = edge distance in metres, straight-line heuristic in
 * metres, ties broken by node index, edges whose status is not "ok" are
 * skipped, and accessible mode skips stairs-only edges.
 *
 * One addition, from the graph data's schema note: in accessible mode an
 * edge with accessibilityCost >= 999 is impassable (see Edge.isStepFree).
 *
 * errorMessage is per instance (it was static in the Android version, which
 * is unsafe when several searches run at once).
 */
public class PathFinder
{
    private String errorMessage = "";

    static class NodeDetails
    {
        Node parent = null;
        double f = Double.MAX_VALUE;
        double g = Double.MAX_VALUE;
        double h = Double.MAX_VALUE;
    }

    static class PQNode implements Comparable<PQNode>
    {
        final double f;
        final Node node;

        PQNode(double f, Node node)
        {
            this.f = f;
            this.node = node;
        }

        @Override
        public int compareTo(PQNode other)
        {
            if (this.f != other.f)
            {
                return Double.compare(this.f, other.f);
            }
            return Integer.compare(this.node.index, other.node.index);
        }
    }

    public String getErrorMessage()
    {
        return errorMessage;
    }

    List<Edge> getSuccessors(Node node, boolean requireAccessible)
    {
        List<Edge> result = new ArrayList<>();
        for (Edge e : node.edges)
        {
            if (!e.status)
            {
                continue;
            }
            if (!requireAccessible || e.isStepFree())
            {
                result.add(e);
            }
        }
        return result;
    }

    double calculateHValue(Node node, Node goal)
    {
        if (node.point == null || goal.point == null)
        {
            return 0.0;
        }
        double dx = node.point.x - goal.point.x;
        double dy = node.point.y - goal.point.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    LinkedList<Node> tracePath(Map<Node, NodeDetails> details, Node src, Node goal)
    {
        LinkedList<Node> path = new LinkedList<>();
        Node current = goal;
        while (current != null && current != src)
        {
            path.addFirst(current);
            current = Objects.requireNonNull(details.get(current)).parent;
        }
        path.addFirst(src);
        return path;
    }

    /**
     * @return the node sequence from src to goal, or null when there is no
     *         route (see getErrorMessage) or src == goal.
     */
    public LinkedList<Node> aStarSearch(Node src, Node goal, boolean requireAccessible)
    {
        errorMessage = "";
        if (src == goal)
        {
            errorMessage = "Start and destination are the same place.";
            return null;
        }

        Set<Node> closedSet = new HashSet<>();
        Map<Node, NodeDetails> details = new HashMap<>();

        NodeDetails startDetails = new NodeDetails();
        startDetails.g = 0.0;
        startDetails.h = calculateHValue(src, goal);
        startDetails.f = startDetails.h;
        startDetails.parent = src;
        details.put(src, startDetails);

        PriorityQueue<PQNode> openList = new PriorityQueue<>();
        openList.offer(new PQNode(startDetails.f, src));

        while (!openList.isEmpty())
        {
            PQNode current = openList.poll();
            Node currentNode = current.node;

            if (closedSet.contains(currentNode))
            {
                continue;
            }
            closedSet.add(currentNode);

            if (currentNode == goal)
            {
                return tracePath(details, src, goal);
            }

            for (Edge edge : getSuccessors(currentNode, requireAccessible))
            {
                Node neighbour = currentNode.other(edge);
                if (neighbour == null || closedSet.contains(neighbour))
                {
                    continue;
                }

                double gNew = Objects.requireNonNull(details.get(currentNode)).g + edge.distance;
                double hNew = calculateHValue(neighbour, goal);
                double fNew = gNew + hNew;

                NodeDetails neighbourDetails = details.computeIfAbsent(neighbour, k -> new NodeDetails());
                if (neighbourDetails.f == Double.MAX_VALUE || neighbourDetails.f > fNew)
                {
                    openList.offer(new PQNode(fNew, neighbour));
                    neighbourDetails.f = fNew;
                    neighbourDetails.g = gNew;
                    neighbourDetails.h = hNew;
                    neighbourDetails.parent = currentNode;
                }
            }
        }

        errorMessage = requireAccessible
                ? "Failed to find an accessible route to the destination node "
                        + "(a path may exist, but only via stairs with no ramp/elevator)."
                : "Failed to find the destination node.";
        return null;
    }
}
