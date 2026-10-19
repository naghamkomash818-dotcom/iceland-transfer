require("dotenv").config();

const http = require("http");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const PORT = process.env.PORT || 3000;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

const PUBLIC_SERVER_URL =
    "https://iceland-transfer-server.onrender.com";

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    console.error("ERROR: Supabase environment variables are missing.");
    process.exit(1);
}

const supabase = createClient(
    SUPABASE_URL,
    SUPABASE_SECRET_KEY
);

const CURRENCY = "ISK";
const WORK_START_HOUR = 6;
const LAST_TRIP_START_HOUR = 22;

const ROUTE_PRICES = {
    "keflavik airport|reykjavik": 20000,
    "reykjavik|keflavik airport": 20000,
    "reykjavik|blue lagoon": 25000,
    "keflavik airport|blue lagoon": 12000,
    "reykjavik|golden circle": 45000,
    "reykjavik|sky lagoon": 15000,
    "reykjavik|cruise port": 8000
};

const DEFAULT_ROUTE_PRICE = 30000;

// --------------------------------------------------
// GOLDEN CIRCLE TOUR PRICES
// Prices are temporary estimates and can be changed.
// --------------------------------------------------

const GOLDEN_CIRCLE_PACKAGES = {
    classic: {
        name: "Classic",
        price: 80400
    },
    extended: {
        name: "Extended",
        price: 128900
    },
    premium: {
        name: "Premium",
        price: 225000
    }
};

const GOLDEN_CIRCLE_ADDONS = {
    kerid: {
        name: "Kerið Crater",
        price_per_passenger: 1500
    },
    fridheimar: {
        name: "Friðheimar",
        price_per_passenger: 2500
    },
    secret_lagoon: {
        name: "Secret Lagoon",
        price_per_passenger: 12000
    }
};

// --------------------------------------------------
// HELPERS
// --------------------------------------------------

function sendJSON(res, statusCode, data) {
    if (res.writableEnded) return;

    res.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
    });

    res.end(JSON.stringify(data));
}

function validDate(value) {
    if (
        typeof value !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(value)
    ) {
        return false;
    }

    const date = new Date(`${value}T00:00:00Z`);

    return (
        !Number.isNaN(date.getTime()) &&
        date.toISOString().slice(0, 10) === value
    );
}

function normalizeTime(value) {
    if (typeof value !== "string") return null;

    const match = value.trim().match(
        /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/
    );

    if (!match) return null;

    const hours = Number(match[1]);
    const minutes = match[2];
    const seconds = match[3] || "00";

    if (minutes !== "00" || seconds !== "00") {
        return null;
    }

    return `${String(hours).padStart(2, "0")}:00:00`;
}

function normalizeLocation(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
}

function canonicalLocation(value) {
    const location = normalizeLocation(value);

    const aliases = {
        "keflavik international airport (kef)": "keflavik airport",
        "keflavik international airport": "keflavik airport",
        "keflavik airport (kef)": "keflavik airport",
        "reykjavik city centre": "reykjavik",
        "reykjavik city center": "reykjavik",
        "reykjavik harbour / old harbour": "cruise port",
        "reykjavik harbor / old harbor": "cruise port"
    };

    return aliases[location] || location;
}

function getRoutePrice(pickup, destination) {
    const pickupName = canonicalLocation(pickup);
    const destinationName = canonicalLocation(destination);

    const routeKey = `${pickupName}|${destinationName}`;

    return ROUTE_PRICES[routeKey] ?? DEFAULT_ROUTE_PRICE;
}

function calculateGoldenCirclePrice(booking) {
    const packageType = String(
        booking.package_type || ""
    ).trim().toLowerCase();

    const selectedPackage = GOLDEN_CIRCLE_PACKAGES[packageType];

    if (!selectedPackage) {
        throw new Error(
            "Please select a valid Golden Circle package."
        );
    }

    const passengers = Number(booking.passengers ?? 1);

    if (
        !Number.isInteger(passengers) ||
        passengers < 1 ||
        passengers > 20
    ) {
        throw new Error(
            "Golden Circle tours allow between 1 and 20 passengers."
        );
    }

    const requestedAddons = booking.addons ?? [];

    if (!Array.isArray(requestedAddons)) {
        throw new Error("Invalid Golden Circle add-ons.");
    }

    const uniqueAddonIds = [...new Set(requestedAddons)];

    const selectedAddons = uniqueAddonIds.map(addonId => {
        if (typeof addonId !== "string") {
            throw new Error("Invalid Golden Circle add-on.");
        }

        const addon = GOLDEN_CIRCLE_ADDONS[addonId];

        if (!addon) {
            throw new Error(
                "An invalid Golden Circle add-on was selected."
            );
        }

        return {
            id: addonId,
            name: addon.name,
            price_per_passenger: addon.price_per_passenger,
            total: addon.price_per_passenger * passengers
        };
    });

    const extrasTotal = selectedAddons.reduce(
        (sum, addon) => sum + addon.total,
        0
    );

    return {
        package_type: packageType,
        package_name: selectedPackage.name,
        base_price: selectedPackage.price,
        addons: selectedAddons,
        extras_total: extrasTotal,
        total: selectedPackage.price + extrasTotal
    };
}

function getIcelandDateTime() {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Atlantic/Reykjavik",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23"
    }).formatToParts(new Date());

    const result = {};

    for (const part of parts) {
        if (part.type !== "literal") {
            result[part.type] = part.value;
        }
    }

    return {
        date: `${result.year}-${result.month}-${result.day}`,
        hour: Number(result.hour),
        minute: Number(result.minute),
        second: Number(result.second)
    };
}

function isWithinWorkingHours(time) {
    const hour = Number(time.slice(0, 2));

    return (
        hour >= WORK_START_HOUR &&
        hour <= LAST_TRIP_START_HOUR
    );
}

function isFutureBooking(date, time) {
    const now = getIcelandDateTime();

    const currentTime =
        `${String(now.hour).padStart(2, "0")}:` +
        `${String(now.minute).padStart(2, "0")}:` +
        `${String(now.second).padStart(2, "0")}`;

    if (date > now.date) return true;
    if (date < now.date) return false;

    return time.slice(0, 8) > currentTime;
}

function isMoreThan24HoursAway(date, time) {
    // Convert Iceland local time to a UTC timestamp using
    // the current Iceland UTC offset. Iceland uses UTC year-round.
    const tripTimestamp = Date.parse(`${date}T${time}Z`);

    return (
        Number.isFinite(tripTimestamp) &&
        tripTimestamp - Date.now() > 24 * 60 * 60 * 1000
    );
}

function makeCancellationToken() {
    return crypto.randomBytes(32).toString("hex");
}

function getRequestBody(req, callback) {
    let body = "";
    let tooLarge = false;

    req.on("data", chunk => {
        body += chunk.toString();

        if (body.length > 100000) {
            tooLarge = true;
        }
    });

    req.on("end", () => {
        if (tooLarge) {
            callback(new Error("REQUEST_TOO_LARGE"));
            return;
        }

        try {
            callback(null, JSON.parse(body));
        } catch {
            callback(new Error("INVALID_JSON"));
        }
    });

    req.on("error", () => {
        callback(new Error("REQUEST_READ_ERROR"));
    });
}

// --------------------------------------------------
// SERVER
// --------------------------------------------------

const server = http.createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, OPTIONS"
    );
    res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type"
    );
    res.setHeader("Access-Control-Max-Age", "86400");

    if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
    }

    const requestURL = new URL(
        req.url,
        `https://${req.headers.host || "localhost"}`
    );

    // HEALTH CHECK
    if (
        req.method === "GET" &&
        requestURL.pathname === "/health"
    ) {
        return sendJSON(res, 200, {
            success: true,
            message: "Iceland Transfer server is running."
        });
    }

    // AVAILABLE TIMES
    if (
        req.method === "GET" &&
        requestURL.pathname === "/api/availability"
    ) {
        try {
            const date = requestURL.searchParams.get("date");

            if (!validDate(date)) {
                return sendJSON(res, 400, {
                    success: false,
                    message: "Please provide a valid date."
                });
            }

            const { data, error } = await supabase
                .from("bookings")
                .select("pickup_time")
                .eq("pickup_date", date)
                .neq("status", "cancelled");

            if (error) {
                console.error(
                    "Availability error:",
                    error.message
                );

                return sendJSON(res, 500, {
                    success: false,
                    message: "Could not load available times."
                });
            }

            const bookedTimes = [
                ...new Set(
                    (data || [])
                        .map(row =>
                            normalizeTime(
                                String(row.pickup_time || "").slice(0, 8)
                            )
                        )
                        .filter(Boolean)
                        .map(time => time.slice(0, 5))
                )
            ];

            const now = getIcelandDateTime();
            const availableTimes = [];

            for (
                let hour = WORK_START_HOUR;
                hour <= LAST_TRIP_START_HOUR;
                hour++
            ) {
                const time =
                    `${String(hour).padStart(2, "0")}:00`;

                if (bookedTimes.includes(time)) continue;
                if (date < now.date) continue;

                if (date === now.date) {
                    const currentMinutes =
                        now.hour * 60 + now.minute;

                    const slotMinutes = hour * 60;

                    if (slotMinutes <= currentMinutes) continue;
                }

                availableTimes.push(time);
            }

            return sendJSON(res, 200, {
                success: true,
                date,
                currency: CURRENCY,
                available_times: availableTimes,
                booked_times: bookedTimes
            });
        } catch (error) {
            console.error(
                "Availability error:",
                error.message
            );

            return sendJSON(res, 500, {
                success: false,
                message: "Could not load available times."
            });
        }
    }

    // CREATE BOOKING
    if (
        req.method === "POST" &&
        requestURL.pathname === "/api/bookings"
    ) {
        return getRequestBody(req, async (bodyError, booking) => {
            if (bodyError) {
                return sendJSON(
                    res,
                    bodyError.message === "REQUEST_TOO_LARGE"
                        ? 413
                        : 400,
                    {
                        success: false,
                        message: "Invalid booking request."
                    }
                );
            }

            try {
                if (
                    !booking ||
                    typeof booking !== "object" ||
                    Array.isArray(booking)
                ) {
                    return sendJSON(res, 400, {
                        success: false,
                        message: "Invalid booking details."
                    });
                }

                const requiredFields = [
                    "full_name",
                    "email",
                    "phone",
                    "pickup_location",
                    "destination",
                    "pickup_date",
                    "pickup_time"
                ];

                for (const field of requiredFields) {
                    if (
                        typeof booking[field] !== "string" ||
                        !booking[field].trim()
                    ) {
                        return sendJSON(res, 400, {
                            success: false,
                            message: `Missing or invalid field: ${field}`
                        });
                    }
                }

                const fullName = booking.full_name.trim();
                const email = booking.email.trim();
                const phone = booking.phone.trim();

                if (fullName.length > 150) {
                    return sendJSON(res, 400, {
                        success: false,
                        message: "Name is too long."
                    });
                }

                if (
                    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
                    email.length > 254
                ) {
                    return sendJSON(res, 400, {
                        success: false,
                        message: "Please enter a valid email."
                    });
                }

                if (phone.length > 40) {
                    return sendJSON(res, 400, {
                        success: false,
                        message: "Phone number is too long."
                    });
                }

                if (!validDate(booking.pickup_date)) {
                    return sendJSON(res, 400, {
                        success: false,
                        message: "Please select a valid date."
                    });
                }

                const pickupTime = normalizeTime(
                    booking.pickup_time
                );

                if (!pickupTime) {
                    return sendJSON(res, 400, {
                        success: false,
                        message: "Please select an hourly pickup time."
                    });
                }

                const pickup = booking.pickup_location.trim();
                const destination = booking.destination.trim();

                if (pickup.length > 200 || destination.length > 200) {
                    return sendJSON(res, 400, {
                        success: false,
                        message: "Pickup or destination is too long."
                    });
                }

                if (
                    normalizeLocation(pickup) ===
                    normalizeLocation(destination)
                ) {
                    return sendJSON(res, 400, {
                        success: false,
                        message: "Pickup and destination must be different."
                    });
                }

                if (!isWithinWorkingHours(pickupTime)) {
                    return sendJSON(res, 400, {
                        success: false,
                        message:
                            "Bookings are available from 06:00 to 22:00 Iceland time."
                    });
                }

                if (
                    !isFutureBooking(
                        booking.pickup_date,
                        pickupTime
                    )
                ) {
                    return sendJSON(res, 400, {
                        success: false,
                        message:
                            "Please select a future pickup time."
                    });
                }

                const passengers = Number(
                    booking.passengers ?? 1
                );

                const luggage = Number(
                    booking.luggage ?? 0
                );

                const serviceType = String(
                    booking.service_type || "transfer"
                ).trim();

                if (
                    !Number.isInteger(passengers) ||
                    passengers < 1 ||
                    passengers > (
                        serviceType === "golden_circle_tour"
                            ? 20
                            : 100
                    ) ||
                    !Number.isInteger(luggage) ||
                    luggage < 0 ||
                    luggage > 100
                ) {
                    return sendJSON(res, 400, {
                        success: false,
                        message:
                            "Invalid passenger or luggage count."
                    });
                }

                let price;
                let tourDetails = null;

                if (serviceType === "golden_circle_tour") {
                    try {
                        tourDetails =
                            calculateGoldenCirclePrice(booking);

                        price = tourDetails.total;
                    } catch (error) {
                        return sendJSON(res, 400, {
                            success: false,
                            message: error.message
                        });
                    }
                } else if (serviceType === "transfer") {
                    price = getRoutePrice(
                        pickup,
                        destination
                    );
                } else {
                    return sendJSON(res, 400, {
                        success: false,
                        message: "Invalid service type."
                    });
                }

                const cancellationToken =
                    makeCancellationToken();

                const newBooking = {
                    full_name: fullName,
                    email,
                    phone,
                    pickup_location: pickup,
                    destination,
                    pickup_date: booking.pickup_date,
                    pickup_time: pickupTime,
                    passengers,
                    luggage,

                    flight_number: booking.flight_number
                        ? String(booking.flight_number).trim().slice(0, 50)
                        : null,

                    special_requests: booking.special_requests
                        ? String(booking.special_requests).trim().slice(0, 2000)
                        : null,

                    service_type: serviceType,

                    package_type: tourDetails
                        ? tourDetails.package_type
                        : null,

                    addons: tourDetails
                        ? tourDetails.addons
                        : [],

                    extras_total: tourDetails
                        ? tourDetails.extras_total
                        : 0,

                    price,
                    status: "confirmed",
                    cancellation_token: cancellationToken
                };

                const { data, error } = await supabase
                    .from("bookings")
                    .insert([newBooking])
                    .select(
                        "id, full_name, email, phone, pickup_location, destination, pickup_date, pickup_time, passengers, luggage, price, status, created_at, service_type, package_type, addons, extras_total"
                    )
                    .single();

                if (error) {
                    console.error(
                        "Booking error:",
                        error.message
                    );

                    if (error.code === "23505") {
                        return sendJSON(res, 409, {
                            success: false,
                            code: "TIME_SLOT_TAKEN",
                            message:
                                "This time has already been booked. Please choose another time."
                        });
                    }

                    return sendJSON(res, 500, {
                        success: false,
                        message:
                            "Could not save the booking. Please try again."
                    });
                }

                const cancellationUrl =
                    `${PUBLIC_SERVER_URL}/api/bookings/cancel/` +
                    cancellationToken;

                return sendJSON(res, 201, {
                    success: true,
                    message: "Your booking has been confirmed.",
                    booking: data,

                    tour_details: tourDetails,

                    invoice: {
                        invoice_number: `IT-${data.id}`,
                        currency: CURRENCY,
                        amount: price,
                        payment_status: "Payment not processed",

                        base_price: tourDetails
                            ? tourDetails.base_price
                            : price,

                        extras_total: tourDetails
                            ? tourDetails.extras_total
                            : 0,

                        addons: tourDetails
                            ? tourDetails.addons
                            : []
                    },

                    cancellation_url: cancellationUrl,

                    cancellation_policy:
                        "Cancellation is allowed only more than 24 hours before pickup."
                });
            } catch (error) {
                console.error(
                    "Booking processing error:",
                    error.message
                );

                return sendJSON(res, 500, {
                    success: false,
                    message:
                        "An unexpected error occurred."
                });
            }
        });
    }

    // CANCEL BOOKING
    const cancelMatch = requestURL.pathname.match(
        /^\/api\/bookings\/cancel\/([a-f0-9]{64})$/
    );

    if (
        cancelMatch &&
        req.method === "POST"
    ) {
        try {
            const token = cancelMatch[1];

            const { data: booking, error } = await supabase
                .from("bookings")
                .select(
                    "id, pickup_date, pickup_time, status, cancellation_token"
                )
                .eq("cancellation_token", token)
                .maybeSingle();

            if (error) {
                console.error(
                    "Cancellation lookup error:",
                    error.message
                );

                return sendJSON(res, 500, {
                    success: false,
                    message:
                        "Could not process the cancellation."
                });
            }

            if (!booking) {
                return sendJSON(res, 404, {
                    success: false,
                    message:
                        "Booking not found or cancellation link is invalid."
                });
            }

            if (booking.status === "cancelled") {
                return sendJSON(res, 200, {
                    success: true,
                    message:
                        "This booking has already been cancelled."
                });
            }

            if (booking.status !== "confirmed") {
                return sendJSON(res, 409, {
                    success: false,
                    message:
                        "This booking cannot be cancelled in its current status."
                });
            }

            const time = normalizeTime(
                String(booking.pickup_time).slice(0, 8)
            );

            if (
                !time ||
                !isMoreThan24HoursAway(
                    booking.pickup_date,
                    time
                )
            ) {
                return sendJSON(res, 403, {
                    success: false,
                    code: "CANCELLATION_WINDOW_CLOSED",
                    message:
                        "Cancellation is only allowed more than 24 hours before pickup."
                });
            }

            const { data: updatedRows, error: updateError } =
                await supabase
                    .from("bookings")
                    .update({
                        status: "cancelled",
                        cancelled_at: new Date().toISOString()
                    })
                    .eq("id", booking.id)
                    .eq("status", "confirmed")
                    .select("id");

            if (updateError) {
                console.error(
                    "Cancellation update error:",
                    updateError.message
                );

                return sendJSON(res, 500, {
                    success: false,
                    message:
                        "Could not cancel the booking. Please try again."
                });
            }

            if (!updatedRows || updatedRows.length === 0) {
                return sendJSON(res, 409, {
                    success: false,
                    message:
                        "This booking has already changed. Please refresh and check its status."
                });
            }

            return sendJSON(res, 200, {
                success: true,
                message:
                    "Your booking has been cancelled successfully.",
                booking_id: booking.id
            });
        } catch (error) {
            console.error(
                "Cancellation error:",
                error.message
            );

            return sendJSON(res, 500, {
                success: false,
                message:
                    "Could not process the cancellation."
            });
        }
    }

    return sendJSON(res, 404, {
        success: false,
        message: "Endpoint not found."
    });
});

server.listen(PORT, "0.0.0.0", () => {
    console.log(
        `Iceland Transfer server running on port ${PORT}`
    );
});