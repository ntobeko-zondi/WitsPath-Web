package com.example.witspath.routing;

import java.util.List;

/**
 * Team Wavelets - WitsPath
 * Estimates travel time for a path based on distance, slope and the user's
 * walking-speed multiplier. Same formula as the Android app:
 *
 *   time = overhead + sum((distance * slopeFactor) / speed) + sum(floorChangePenalty)
 *
 * The Android version read the multiplier from SharedPreferences; here it is
 * passed in, so the same class works on a phone and on a server.
 */
public class TravelTimeEstimator
{
    private final double speedMultiplier;
    private final double baseSpeedMps;

    public TravelTimeEstimator(double speedMultiplier)
    {
        this(speedMultiplier, RouteOptions.NONE);
    }

    /** @param mobilityProfile sets the base speed (TravelTimeConfig.speedFor) */
    public TravelTimeEstimator(double speedMultiplier, String mobilityProfile)
    {
        this.speedMultiplier = speedMultiplier > 0 ? speedMultiplier : 1.0;
        this.baseSpeedMps = TravelTimeConfig.speedFor(mobilityProfile);
    }

    /** Estimated travel time for a route, in seconds. */
    public double estimateTime(List<Node> path)
    {
        if (path == null || path.size() < 2)
        {
            return 0;
        }

        double totalSeconds = TravelTimeConfig.OVERHEAD_SECONDS;
        double speedMps = baseSpeedMps * speedMultiplier;

        for (int i = 0; i < path.size() - 1; i++)
        {
            Node current = path.get(i);
            Node next = path.get(i + 1);

            Edge edge = CampusGraph.edgeBetween(current, next);
            if (edge != null)
            {
                totalSeconds += (edge.distance * slopeFactor(edge, current)) / speedMps;
            }

            if (current.floorId != null && next.floorId != null && !current.floorId.equals(next.floorId))
            {
                totalSeconds += floorChangePenalty(edge);
            }
        }

        return totalSeconds;
    }

    private double slopeFactor(Edge edge, Node fromNode)
    {
        if (edge.uphillFromNodeId == null)
        {
            return 1.0; // Flat or unknown
        }
        if (edge.uphillFromNodeId.equals(fromNode.nodeId))
        {
            return TravelTimeConfig.UPHILL_FACTOR; // Travelling uphill
        }
        return 1.0; // Travelling downhill
    }

    private int floorChangePenalty(Edge edge)
    {
        if (edge == null)
        {
            return TravelTimeConfig.DEFAULT_FLOOR_CHANGE_PENALTY;
        }
        if (edge.elevator)
        {
            return TravelTimeConfig.ELEVATOR_PENALTY_SECONDS;
        }
        if (edge.stairs)
        {
            return TravelTimeConfig.STAIRS_PENALTY_SECONDS;
        }
        return TravelTimeConfig.DEFAULT_FLOOR_CHANGE_PENALTY;
    }
}
