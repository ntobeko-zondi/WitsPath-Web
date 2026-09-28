package com.example.witspath.routing;

/**
 * How a route should be chosen. Mobility profiles use the Android app's ids
 * (Prefs.KEY_MOBILITY_PROFILE): none, wheelchair, walking_aid, low_vision.
 *
 * The profile rules come from the website team's route planner and now live
 * here so the website and the app share them.
 */
public class RouteOptions
{
    public static final String NONE = "none";
    public static final String WHEELCHAIR = "wheelchair";
    public static final String WALKING_AID = "walking_aid";
    public static final String LOW_VISION = "low_vision";

    public final String mobilityProfile;
    /** Never use stairs-only edges (always true for the wheelchair profile). */
    public final boolean stepFree;
    public final boolean preferLifts;
    public final boolean avoidSteepRamps;

    public RouteOptions(String mobilityProfile, boolean stepFree, boolean preferLifts, boolean avoidSteepRamps)
    {
        this.mobilityProfile = isKnown(mobilityProfile) ? mobilityProfile : NONE;
        this.stepFree = stepFree || WHEELCHAIR.equals(this.mobilityProfile);
        this.preferLifts = preferLifts;
        this.avoidSteepRamps = avoidSteepRamps;
    }

    /** The Android app's original call: only "accessible or not". */
    public static RouteOptions accessible(boolean requireAccessible)
    {
        return new RouteOptions(NONE, requireAccessible, false, false);
    }

    public static boolean isKnown(String profile)
    {
        return NONE.equals(profile) || WHEELCHAIR.equals(profile) || WALKING_AID.equals(profile) || LOW_VISION.equals(profile);
    }

    /** Key used for per-profile data in the graph JSON (accessibilityCosts, inaccessibleFor). */
    String dataKey()
    {
        switch (mobilityProfile)
        {
            case WALKING_AID: return "walkingAid";
            case LOW_VISION: return "lowVision";
            case WHEELCHAIR: return "wheelchair";
            default: return "noPreference";
        }
    }
}
