"""Display verified units; retain explicit raw units for undocumented fields."""

def title(ride):
    return ride.get("title") or ride.get("rideName") or ride.get("name") or "Ride"


def igps_row(ride):
    fields = [str(ride.get("startTime", "")), str(title(ride))]
    for key, label, factor, unit in (("rideDistance", "distance", 0.001, "km"),
                                    ("totalMovingTime", "moving time", 1 / 60, "min"),
                                    ("avgSpeed", "avg speed", 3.6, "km/h")):
        value = ride.get(key)
        if isinstance(value, (int, float)):
            fields.append(f"{label}: {value * factor:.2f} {unit}")
    for key, label in (("totalAscent", "ascent"),):
        if ride.get(key) is not None:
            fields.append(f"{label}: {ride[key]} (API units)")
    if ride.get("productName"):
        fields.append(f"device: {ride['productName']}")
    fields.append(f"ID {ride.get('rideId')}")
    return " | ".join(fields)


def garmin_row(ride):
    fields = [str(ride.get("startTimeLocal", "")), str(ride.get("activityName") or "Activity")]
    for key, divisor, label in (("distance", 1000, "km"), ("duration", 60, "min")):
        value = ride.get(key)
        if isinstance(value, (int, float)):
            fields.append(f"{value / divisor:.2f} {label}")
    fields.append(f"ID {ride.get('activityId')}")
    return " | ".join(fields)
