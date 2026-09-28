package com.example.witspath.routing;

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
}
