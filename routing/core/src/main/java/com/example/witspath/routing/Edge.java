package com.example.witspath.routing;

import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

/**
 * A walkable connection between two nodes.
 *
 * Compared with the Android app's Edge this keeps the Firestore edgeId (so
 * reports can reference a real edge) and adds uphillFromNodeId, which
 * TravelTimeEstimator already expected.
 */
public class Edge
{
    /** Graph schema: accessibilityCost at or above this is impassable step-free. */
    public static final double IMPASSABLE_COST = 999.0;

    public final String edgeId;
    public final Node node1;
    public final Node node2;
    public final double distance;
    public final double accessibilityCost;
    public final boolean ramp;
    public final boolean stairs;
    public final boolean elevator;
    /** true when status is "ok"; "flagged" and "blocked" are not usable. */
    public final boolean status;
    public final String statusText;
    public final String label;
    /** nodeId of the lower end, or null for flat/unknown. */
    public final String uphillFromNodeId;
    /** A ramp steeper than 1:12 (optional data). */
    public boolean steepRamp;
    /** Per-profile cost multipliers, keyed wheelchair / walkingAid / lowVision / noPreference (optional data). */
    public final Map<String, Double> profileCosts = new HashMap<>();
    /** Mobility profiles (Android ids) that can't use this edge at all (optional data). */
    public final Set<String> inaccessibleFor = new HashSet<>();

    public Edge(String edgeId, Node node1, Node node2, double distance, double accessibilityCost,
                boolean ramp, boolean stairs, boolean elevator, String statusText, String label,
                String uphillFromNodeId)
    {
        this.edgeId = edgeId;
        this.node1 = node1;
        this.node2 = node2;
        this.distance = distance;
        this.accessibilityCost = accessibilityCost;
        this.ramp = ramp;
        this.stairs = stairs;
        this.elevator = elevator;
        this.statusText = statusText == null ? "ok" : statusText;
        this.status = "ok".equalsIgnoreCase(this.statusText);
        this.label = label == null ? "" : label;
        this.uphillFromNodeId = uphillFromNodeId;

        node1.edges.add(this);
        node2.edges.add(this);
    }

    /** Usable by someone who cannot use stairs. */
    public boolean isStepFree()
    {
        return (!stairs || ramp || elevator) && accessibilityCost < IMPASSABLE_COST;
    }

    public boolean isStairsOnly()
    {
        return stairs && !ramp && !elevator;
    }

    /** Cost multiplier for a profile: its own value if the data has one, else accessibilityCost. */
    public double costFor(RouteOptions options)
    {
        Double own = profileCosts.get(options.dataKey());
        return own != null ? own : accessibilityCost;
    }
}
