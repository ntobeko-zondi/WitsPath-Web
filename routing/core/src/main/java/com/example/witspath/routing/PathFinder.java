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
 * algorithm: straight-line heuristic in metres, ties broken by node index,
 * edges whose status is not "ok" are skipped, and step-free mode skips
 * stairs-only edges. aStarSearch(src, goal, accessible) behaves as before.
 *
 * Additions:
 *  - From the graph schema note: cost = distance x accessibilityCost, and
 *    accessibilityCost >= 999 is impassable step-free (Edge.isStepFree).
 *    (All current data has cost 1, so today's routes are unchanged.)
 *  - From the website team's planner (RouteOptions): mobility profiles with
 *    optional per-profile costs and inaccessible edges, "prefer lifts" and
 *    "avoid steep ramps". See edgeCost.
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

    /** Edges this person can use from a node. */
    List<Edge> getSuccessors(Node node, RouteOptions options)
    {
        List<Edge> result = new ArrayList<>();
        for (Edge e : node.edges)
        {
            if (!e.status)
            {
                continue;
            }
            if (options.stepFree && !e.isStepFree())
            {
                continue;
            }
            // accessibilityCost >= 999 only closes an edge for step-free routing
            // (graph schema note, handled by isStepFree above); a profile's own
            // cost of >= 999 closes it for that profile.
            Double profileCost = e.profileCosts.get(options.dataKey());
            boolean closedForProfile = profileCost != null && profileCost >= Edge.IMPASSABLE_COST;
            if (closedForProfile || e.inaccessibleFor.contains(options.mobilityProfile))
            {
                continue;
            }
            if (options.avoidSteepRamps && e.ramp && e.steepRamp)
            {
                continue;
            }
            result.add(e);
        }
        return result;
    }

    /**
     * Search cost of an edge: distance x the profile's cost multiplier, with
     * the website planner's preferences. Every factor is >= 1 so the
     * straight-line heuristic never overestimates and A* stays optimal:
     *   - walking aid: stairs-only edges x 1.5
     *   - prefer lifts: lifts x 1, plain edges x 4/3, ramps x 1.8 (the same
     *     order as the planner's 0.75 / 1 / 1.35, scaled so nothing is below 1)
     */
    double edgeCost(Edge e, RouteOptions options)
    {
        double cost = e.distance * Math.max(1.0, e.costFor(options));
        if (RouteOptions.WALKING_AID.equals(options.mobilityProfile) && e.isStairsOnly())
        {
            cost *= 1.5;
        }
        if (options.preferLifts)
        {
            cost *= e.elevator ? 1.0 : e.ramp ? 1.35 / 0.75 : 1.0 / 0.75;
        }
        return cost;
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
        return aStarSearch(src, goal, RouteOptions.accessible(requireAccessible));
    }

    public LinkedList<Node> aStarSearch(Node src, Node goal, RouteOptions options)
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

            for (Edge edge : getSuccessors(currentNode, options))
            {
                Node neighbour = currentNode.other(edge);
                if (neighbour == null || closedSet.contains(neighbour))
                {
                    continue;
                }

                double gNew = Objects.requireNonNull(details.get(currentNode)).g + edgeCost(edge, options);
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

        errorMessage = options.stepFree
                ? "Failed to find an accessible route to the destination node "
                        + "(a path may exist, but only via stairs with no ramp/elevator)."
                : "Failed to find the destination node.";
        return null;
    }
}
