'use strict';

const EARTH_RADIUS_M = 6371008.8;

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

/** Great-circle (straight-line) distance in metres. */
function distanceMetres(a, b) {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

function isValidLatLng(value) {
  return (
    value &&
    Number.isFinite(value.lat) &&
    Number.isFinite(value.lng) &&
    value.lat >= -90 &&
    value.lat <= 90 &&
    value.lng >= -180 &&
    value.lng <= 180
  );
}

module.exports = { distanceMetres, isValidLatLng };
