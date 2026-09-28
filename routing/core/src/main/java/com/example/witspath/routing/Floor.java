package com.example.witspath.routing;

/**
 * Metadata for one floor plan (one entry of floors[] in the graph JSON).
 * Node coordinates in the JSON are image pixels; metresPerPixel converts them.
 */
public class Floor
{
    public final String floorId;
    public final String name;
    public final int level;
    public final int imageWidth;
    public final int imageHeight;
    public final double metresPerPixel;

    public Floor(String floorId, String name, int level, int imageWidth, int imageHeight, double metresPerPixel)
    {
        this.floorId = floorId;
        this.name = name;
        this.level = level;
        this.imageWidth = imageWidth;
        this.imageHeight = imageHeight;
        this.metresPerPixel = metresPerPixel;
    }

    public double pixelsToMetres(double pixelValue)
    {
        return pixelValue * metresPerPixel;
    }

    public double metresToPixels(double metreValue)
    {
        return metreValue / metresPerPixel;
    }
}
