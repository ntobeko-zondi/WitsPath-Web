package com.example.witspath.routing;

/**
 * Team Wavelets - WitsPath
 * Central configuration for travel-time estimation (unchanged from the
 * Android app).
 */
public final class TravelTimeConfig
{
    private TravelTimeConfig()
    {
        // static constants only
    }

    /** Default walking speed in metres per second. */
    public static final double DEFAULT_SPEED_MPS = 1.4;

    /** Fixed overhead in seconds for building entry/exit and orientation. */
    public static final int OVERHEAD_SECONDS = 30;

    /** Multiplier applied to distance for uphill travel. */
    public static final double UPHILL_FACTOR = 1.8;

    /** Penalty in seconds for changing floors via stairs. */
    public static final int STAIRS_PENALTY_SECONDS = 20;

    /** Penalty in seconds for changing floors via elevator (waiting + transit). */
    public static final int ELEVATOR_PENALTY_SECONDS = 45;

    /** Default penalty in seconds for a generic floor change if type is unknown. */
    public static final int DEFAULT_FLOOR_CHANGE_PENALTY = 30;
}
