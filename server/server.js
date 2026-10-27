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
    console.error(
        "ERROR: SUPABASE_URL and SUPABASE_SECRET_KEY must be configured."
    );
    process.exit(1);
}

const supabase = createClient(
    SUPABASE_URL,
    SUPABASE_SECRET_KEY,
    {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    }
);

// ========================================
// VEHICLE PRICES
// ========================================

const VEHICLES = {
    sedan: {
        name: "Sedan",
        price: 17900,
        capacity: 4
    },

    mpv: {
        name: "MPV",
        price: 21900,
        capacity: 4
    },

    van: {
        name: "Van",
        price: 26900,
        capacity: 8
    },

    vip_van: {
        name: "VIP Van",
        price: 32000,
        capacity: 5
    }
};

const MAX_SIMULTANEOUS_BOOKINGS = 3;

const OPENING_HOUR = 6;
const CLOSING_HOUR = 22;

const CANCELLATION_LIMIT_HOURS = 24;

// ========================================
// GENERAL HELPERS
// ========================================

function sendJSON(res, statusCode, data) {
    res.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Cache-Control": "no-store"
    });

    res.end(JSON.stringify(data));
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = "";
        let size = 0;

        const MAX_BODY_SIZE = 100000;

        req.on("data", chunk => {
            size += chunk.length;

            if (size > MAX_BODY_SIZE) {
                reject(new Error("REQUEST_TOO_LARGE"));
                req.destroy();
                return;
            }

            body += chunk;
        });

        req.on("end", () => {
            if (!body.trim()) {
                resolve({});
                return;
            }

            try {
                resolve(JSON.parse(body));
            } catch {
                reject(new Error("INVALID_JSON"));
            }
        });

        req.on("error", reject);
    });
}

function getValue(object, keys, fallback = "") {
    for (const key of keys) {
        const value = object[key];

        if (
            value !== undefined &&
            value !== null &&
            String(value).trim() !== ""
        ) {
            return value;
        }
    }

    return fallback;
}

function cleanText(value, maxLength = 1000) {
    return String(value ?? "")
        .trim()
        .slice(0, maxLength);
}

// ========================================
// NORMALIZE VEHICLE
// ========================================

function normalizeVehicle(value) {
    let original = cleanText(value, 150).toLowerCase();

    // Remove passenger descriptions from labels such as:
    // "Sedan — up to 4 passengers"
    // "MPV4 - 4 passengers"
    original = original.split(/[—–]/)[0].trim();

    original = original
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    const aliases = {
        "sedan": "sedan",
        "standard sedan": "sedan",
        "car": "sedan",
        "sedan 4": "sedan",
        "sedan 4 passengers": "sedan",
        "sedan up to 4 passengers": "sedan",

        "mpv": "mpv",
        "mpv4": "mpv",
        "mpv 4": "mpv",
        "mpv 4 passengers": "mpv",
        "mpv up to 4 passengers": "mpv",

        "van": "van",
        "standard van": "van",
        "van 8": "van",
        "van 8 passengers": "van",
        "van up to 8 passengers": "van",

        "vip van": "vip_van",
        "vip": "vip_van",
        "vipvan": "vip_van",
        "vip van 5": "vip_van",
        "vip van 5 passengers": "vip_van",
        "vip van up to 5 passengers": "vip_van"
    };

    if (aliases[original]) {
        return aliases[original];
    }

    // Handle labels where a description follows the vehicle name.
    if (/^sedan\b/.test(original)) {
        return "sedan";
    }

    if (/^mpv\s*4?\b/.test(original)) {
        return "mpv";
    }

    if (/^standard van\b/.test(original) || /^van\b/.test(original)) {
        return "van";
    }

    if (/^vip\s*van\b/.test(original) || /^vipvan\b/.test(original)) {
        return "vip_van";
    }

    return "";
}

// ========================================
// NORMALIZE SERVICE TYPE
// ========================================

function normalizeServiceType(value, data = {}) {
    const text = cleanText(
        value ||
        data.service_type ||
        data.service ||
        data.service_name ||
        data.name,
        150
    ).toLowerCase();

    if (text.includes("golden") || text.includes("circle")) {
        return "golden_circle";
    }

    if (
        text.includes("northern") ||
        text.includes("aurora") ||
        text.includes("lights")
    ) {
        return "northern_lights";
    }

    if (text.includes("keflavik") || text.includes("airport")) {
        return "keflavik_shuttle";
    }

    if (text.includes("reykjavik")) {
        return "reykjavik_shuttle";
    }

    return "transfer";
}

function getServiceDuration(serviceType) {
    if (serviceType === "golden_circle") {
        return 8;
    }

    if (serviceType === "northern_lights") {
        return 5;
    }

    return 1;
}

function getIcelandNow() {
    // Iceland uses UTC year-round.
    return new Date();
}

function isValidDateString(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return false;
    }

    const date = new Date(`${value}T00:00:00Z`);

    return (
        !Number.isNaN(date.getTime()) &&
        date.toISOString().slice(0, 10) === value
    );
}

function isValidTimeString(value) {
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function dateTimeAsUTC(date, time) {
    return new Date(`${date}T${time}:00Z`);
}

function isFuturePickup(date, time) {
    const pickup = dateTimeAsUTC(date, time);

    return pickup.getTime() > getIcelandNow().getTime();
}

function getTripEnd(date, time, durationHours) {
    const start = dateTimeAsUTC(date, time);

    const end = new Date(
        start.getTime() + durationHours * 60 * 60 * 1000
    );

    return end.toISOString().slice(0, 19);
}

function intervalsOverlap(startA, endA, startB, endB) {
    return startA < endB && startB < endA;
}

function createCancellationToken() {
    return crypto.randomBytes(32).toString("hex");
}

function getBookingStart(booking) {
    return dateTimeAsUTC(
        booking.pickup_date,
        booking.pickup_time
    );
}

function getBookingEnd(booking) {
    const start = getBookingStart(booking);

    const duration = Number(
        booking.service_duration_hours || 1
    );

    return new Date(
        start.getTime() + duration * 60 * 60 * 1000
    );
}

// ========================================
// LOAD BOOKINGS FOR AVAILABILITY CHECKS
// ========================================

async function loadBookingsForDate(date) {
    const targetDate = new Date(`${date}T00:00:00Z`);

    const previousDate = new Date(
        targetDate.getTime() - 24 * 60 * 60 * 1000
    );

    const nextDate = new Date(
        targetDate.getTime() + 24 * 60 * 60 * 1000
    );

    const fromDate = previousDate.toISOString().slice(0, 10);
    const toDate = nextDate.toISOString().slice(0, 10);

    const { data, error } = await supabase
        .from("bookings")
        .select(
            "id,pickup_date,pickup_time,status,service_duration_hours,trip_end_time"
        )
        .gte("pickup_date", fromDate)
        .lte("pickup_date", toDate);

    if (error) {
        console.error(
            "Supabase availability error:",
            error.message
        );

        throw new Error("AVAILABILITY_CHECK_FAILED");
    }

    return (data || []).filter(booking => {
        return String(booking.status || "").toLowerCase() !== "cancelled";
    });
}

// ========================================
// COUNT OVERLAPPING BOOKINGS
// ========================================

function countOverlappingBookings(
    bookings,
    date,
    time,
    durationHours
) {
    const requestedStart = dateTimeAsUTC(date, time);

    const requestedEnd = new Date(
        requestedStart.getTime() +
        durationHours * 60 * 60 * 1000
    );

    let count = 0;

    for (const booking of bookings) {
        const existingStart = getBookingStart(booking);
        const existingEnd = getBookingEnd(booking);

        if (
            intervalsOverlap(
                requestedStart,
                requestedEnd,
                existingStart,
                existingEnd
            )
        ) {
            count++;
        }
    }

    return count;
}

async function checkAvailability(date, time, durationHours) {
    const bookings = await loadBookingsForDate(date);

    const overlapping = countOverlappingBookings(
        bookings,
        date,
        time,
        durationHours
    );

    return {
        available: overlapping < MAX_SIMULTANEOUS_BOOKINGS,
        overlappingBookings: overlapping,
        remainingSlots: Math.max(
            0,
            MAX_SIMULTANEOUS_BOOKINGS - overlapping
        ),
        maxBookings: MAX_SIMULTANEOUS_BOOKINGS
    };
}

// ========================================
// GENERATE AVAILABLE TIMES
// ========================================

async function getAvailableTimes(date, durationHours) {
    const bookings = await loadBookingsForDate(date);

    const availableTimes = [];

    for (
        let minutes = OPENING_HOUR * 60;
        minutes <= CLOSING_HOUR * 60;
        minutes += 30
    ) {
        const hour = Math.floor(minutes / 60);
        const minute = minutes % 60;

        const time =
            String(hour).padStart(2, "0") +
            ":" +
            String(minute).padStart(2, "0");

        if (
            minutes + durationHours * 60 >
            CLOSING_HOUR * 60
        ) {
            continue;
        }

        if (!isFuturePickup(date, time)) {
            continue;
        }

        const overlapping = countOverlappingBookings(
            bookings,
            date,
            time,
            durationHours
        );

        if (overlapping < MAX_SIMULTANEOUS_BOOKINGS) {
            availableTimes.push(time);
        }
    }

    return availableTimes;
}

// ========================================
// CREATE A BOOKING
// ========================================

async function createBooking(data) {
    const fullName = cleanText(
        getValue(data, ["full_name", "customerName", "name"]),
        150
    );

    const email = cleanText(
        getValue(data, ["email"]),
        254
    ).toLowerCase();

    const phone = cleanText(
        getValue(data, ["phone", "telephone"]),
        50
    );

    const pickupLocation = cleanText(
        getValue(data, [
            "pickup_location",
            "pickupLocation",
            "pickup"
        ]),
        300
    );

    const destination = cleanText(
        getValue(data, [
            "destination",
            "destination_location",
            "dropoff_location",
            "dropoff"
        ]),
        300
    );

    const pickupDate = cleanText(
        getValue(data, ["pickup_date", "date"]),
        10
    );

    const pickupTime = cleanText(
        getValue(data, ["pickup_time", "time"]),
        5
    );

    const vehicleInput = getValue(data, [
        "vehicle_type",
        "vehicle_name",
        "vehicle"
    ]);

    const vehicleKey = normalizeVehicle(vehicleInput);

    const passengers = Number(
        getValue(data, ["passengers", "passenger_count"], 1)
    );

    const luggage = Number(
        getValue(data, ["luggage", "luggage_count"], 0)
    );

    const serviceType = normalizeServiceType(
        getValue(data, [
            "service_type",
            "service",
            "service_name"
        ]),
        data
    );

    const durationHours = getServiceDuration(serviceType);

    const specialRequests = cleanText(
        getValue(data, [
            "special_requests",
            "specialRequests",
            "notes"
        ]),
        2000
    );

    const flightNumber = cleanText(
        getValue(data, ["flight_number", "flightNumber"]),
        100
    );

    const packageType = cleanText(
        getValue(data, ["package_type", "packageType", "package"]),
        150
    );

    const countryOfOrigin = cleanText(
        getValue(data, [
            "country_of_origin",
            "countryOfOrigin",
            "country"
        ]),
        100
    );

    const childrenCount = Number(
        getValue(data, ["children_count", "childrenCount"], 0)
    );

    const childrenAges = getValue(data, [
        "children_ages",
        "child_ages",
        "childrenAges"
    ], "");

    const travellingWithChildren = getValue(data, [
        "travelling_with_children",
        "travellingWithChildren"
    ], "");

    const selectedStops = getValue(data, [
        "selected_stops",
        "selectedStops",
        "stops"
    ], []);

    const addons = getValue(data, ["addons", "extras"], []);

    // ========================================
    // VALIDATE REQUIRED FIELDS
    // ========================================

    if (
        !fullName ||
        !email ||
        !phone ||
        !pickupLocation ||
        !destination ||
        !pickupDate ||
        !pickupTime
    ) {
        throw {
            status: 400,
            code: "MISSING_REQUIRED_FIELDS",
            message: "Please complete all required booking fields."
        };
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw {
            status: 400,
            code: "INVALID_EMAIL",
            message: "Please enter a valid email address."
        };
    }

    if (!isValidDateString(pickupDate)) {
        throw {
            status: 400,
            code: "INVALID_DATE",
            message: "Please select a valid pickup date."
        };
    }

    if (!isValidTimeString(pickupTime)) {
        throw {
            status: 400,
            code: "INVALID_TIME",
            message: "Please select a valid pickup time."
        };
    }

    if (!isFuturePickup(pickupDate, pickupTime)) {
        throw {
            status: 400,
            code: "PICKUP_MUST_BE_IN_FUTURE",
            message: "Pickup date and time must be in the future."
        };
    }

    const [hour, minute] = pickupTime.split(":").map(Number);
    const pickupMinutes = hour * 60 + minute;

    if (
        pickupMinutes < OPENING_HOUR * 60 ||
        pickupMinutes >= CLOSING_HOUR * 60
    ) {
        throw {
            status: 400,
            code: "OUTSIDE_OPERATING_HOURS",
            message: "Bookings are available between 06:00 and 22:00."
        };
    }

    if (
        pickupMinutes + durationHours * 60 >
        CLOSING_HOUR * 60
    ) {
        throw {
            status: 400,
            code: "TRIP_ENDS_AFTER_CLOSING",
            message:
                "Please select a pickup time that allows the trip to finish by 22:00."
        };
    }

    if (
        pickupLocation.toLowerCase() === destination.toLowerCase() &&
        serviceType !== "northern_lights"
    ) {
        throw {
            status: 400,
            code: "SAME_PICKUP_AND_DESTINATION",
            message: "Pickup and destination must be different."
        };
    }

    if (
        !Number.isInteger(passengers) ||
        passengers < 1 ||
        passengers > 20
    ) {
        throw {
            status: 400,
            code: "INVALID_PASSENGER_COUNT",
            message: "Passenger count must be between 1 and 20."
        };
    }

    if (
        !Number.isInteger(luggage) ||
        luggage < 0 ||
        luggage > 50
    ) {
        throw {
            status: 400,
            code: "INVALID_LUGGAGE_COUNT",
            message: "Please enter a valid luggage count."
        };
    }

    if (
        !Number.isInteger(childrenCount) ||
        childrenCount < 0 ||
        childrenCount > passengers
    ) {
        throw {
            status: 400,
            code: "INVALID_CHILDREN_COUNT",
            message: "Please enter a valid number of children."
        };
    }

    if (!vehicleKey || !VEHICLES[vehicleKey]) {
        throw {
            status: 400,
            code: "INVALID_VEHICLE",
            message:
                "Please select a valid vehicle. Received vehicle: " +
                cleanText(vehicleInput, 100)
        };
    }

    const vehicle = VEHICLES[vehicleKey];

    if (passengers > vehicle.capacity) {
        throw {
            status: 400,
            code: "VEHICLE_CAPACITY_EXCEEDED",
            message:
                `${vehicle.name} can carry up to ${vehicle.capacity} passengers. Please select a suitable vehicle.`
        };
    }

    // ========================================
    // SERVER-SIDE VEHICLE PRICE
    // ========================================
    // Do not trust a price sent by the browser.
    // The selected vehicle determines the price.

    const price = vehicle.price;
    const extrasTotal = 0;
    const total = price + extrasTotal;

    const tripEndTime = getTripEnd(
        pickupDate,
        pickupTime,
        durationHours
    );

    // ========================================
    // CHECK AVAILABILITY
    // ========================================

    const availability = await checkAvailability(
        pickupDate,
        pickupTime,
        durationHours
    );

    if (!availability.available) {
        throw {
            status: 409,
            code: "TIME_SLOT_FULL",
            message:
                "This time is fully booked. Please choose another time."
        };
    }

    // ========================================
    // SAVE ADDITIONAL DETAILS
    // ========================================

    const details = [];

    if (specialRequests) {
        details.push(`Special requests: ${specialRequests}`);
    }

    details.push(`Selected vehicle: ${vehicle.name}`);
    details.push(`Vehicle price: ${price} ISK`);

    if (countryOfOrigin) {
        details.push(`Country of origin: ${countryOfOrigin}`);
    }

    if (childrenCount > 0) {
        details.push(`Children count: ${childrenCount}`);
    }

    if (String(childrenAges).trim()) {
        details.push(
            `Children ages: ${cleanText(childrenAges, 200)}`
        );
    }

    if (String(travellingWithChildren).trim()) {
        details.push(
            `Travelling with children: ${cleanText(travellingWithChildren, 100)}`
        );
    }

    const savedSpecialRequests = details.join("\n");

    const token = createCancellationToken();

    const safeAddons = Array.isArray(addons)
        ? addons.map(item => cleanText(item, 150))
        : [];

    const safeStops = Array.isArray(selectedStops)
        ? selectedStops.map(item => cleanText(item, 150))
        : [];

    // ========================================
    // SAVE BOOKING IN SUPABASE
    // ========================================

    const bookingData = {
        full_name: fullName,
        email,
        phone,
        pickup_location: pickupLocation,
        destination,
        pickup_date: pickupDate,
        pickup_time: pickupTime,
        passengers,
        luggage,
        flight_number: flightNumber || null,
        special_requests: savedSpecialRequests,
        price: total,
        status: "confirmed",
        cancellation_token: token,
        cancelled_at: null,
        service_type: serviceType,
        package_type: packageType || null,
        addons: safeAddons,
        extras_total: extrasTotal,
        trip_end_time: tripEndTime,
        service_duration_hours: durationHours,
        selected_stops: safeStops
    };

    const { data: savedBooking, error } = await supabase
        .from("bookings")
        .insert([bookingData])
        .select()
        .single();

    if (error) {
        console.error(
            "Supabase booking error:",
            error.message
        );

        throw {
            status: 500,
            code: "BOOKING_SAVE_FAILED",
            message:
                "We could not save your booking. Please try again."
        };
    }

    const cancellationURL =
        `${PUBLIC_SERVER_URL}/api/bookings/cancel/${token}`;

    // ========================================
    // BOOKING RESPONSE AND INVOICE
    // ========================================

    return {
        success: true,

        message: "Your booking has been confirmed.",

        booking: {
            ...savedBooking,
            vehicle_type: vehicleKey,
            vehicle_name: vehicle.name,
            vehicle_capacity: vehicle.capacity,
            price: total,
            extras_total: extrasTotal,
            total
        },

        data: {
            ...savedBooking,
            vehicle_type: vehicleKey,
            vehicle_name: vehicle.name,
            vehicle_capacity: vehicle.capacity,
            price: total,
            extras_total: extrasTotal,
            total
        },

        invoice: {
            booking_id: savedBooking.id,
            full_name: fullName,
            email,
            phone,
            pickup_location: pickupLocation,
            destination,
            pickup_date: pickupDate,
            pickup_time: pickupTime,
            passengers,
            luggage,
            flight_number: flightNumber,
            service_type: serviceType,
            package_type: packageType || null,
            vehicle_type: vehicleKey,
            vehicle_name: vehicle.name,
            vehicle_capacity: vehicle.capacity,
            price: total,
            extras_total: extrasTotal,
            total,
            currency: "ISK",
            cancellation_url: cancellationURL,
            cancellation_token: token
        },

        cancellation_token: token,
        cancellation_url: cancellationURL
    };
}

// ========================================
// CANCEL A BOOKING
// ========================================

async function cancelBooking(token) {
    const cancellationToken = cleanText(token, 200);

    if (!cancellationToken) {
        throw {
            status: 400,
            code: "MISSING_CANCELLATION_TOKEN",
            message: "A cancellation token is required."
        };
    }

    const { data: booking, error: findError } =
        await supabase
            .from("bookings")
            .select("*")
            .eq("cancellation_token", cancellationToken)
            .maybeSingle();

    if (findError) {
        console.error(
            "Cancellation lookup error:",
            findError.message
        );

        throw {
            status: 500,
            code: "CANCELLATION_LOOKUP_FAILED",
            message: "We could not look up this booking."
        };
    }

    if (!booking) {
        throw {
            status: 404,
            code: "BOOKING_NOT_FOUND",
            message:
                "Booking not found. Please check your cancellation link."
        };
    }

    if (String(booking.status || "").toLowerCase() === "cancelled") {
        throw {
            status: 409,
            code: "ALREADY_CANCELLED",
            message: "This booking has already been cancelled."
        };
    }

    const pickup = getBookingStart(booking);

    const hoursUntilPickup =
        (pickup.getTime() - Date.now()) / (60 * 60 * 1000);

    if (hoursUntilPickup <= CANCELLATION_LIMIT_HOURS) {
        throw {
            status: 400,
            code: "CANCELLATION_DEADLINE_PASSED",
            message:
                "Bookings can only be cancelled more than 24 hours before pickup."
        };
    }

    const { data: updatedBooking, error: updateError } =
        await supabase
            .from("bookings")
            .update({
                status: "cancelled",
                cancelled_at: new Date().toISOString()
            })
            .eq("id", booking.id)
            .select()
            .single();

    if (updateError) {
        console.error(
            "Cancellation update error:",
            updateError.message
        );

        throw {
            status: 500,
            code: "CANCELLATION_FAILED",
            message:
                "We could not cancel this booking. Please try again."
        };
    }

    return {
        success: true,
        message: "Your booking has been cancelled.",
        booking: updatedBooking
    };
}

// ========================================
// HTTP SERVER
// ========================================

const server = http.createServer(async (req, res) => {
    if (req.method === "OPTIONS") {
        res.writeHead(204, {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
            "Access-Control-Max-Age": "86400"
        });

        res.end();
        return;
    }

    let pathname;

    try {
        const requestURL = new URL(
            req.url,
            `http://${req.headers.host || "localhost"}`
        );

        pathname = requestURL.pathname;

        // ========================================
        // HEALTH CHECK
        // ========================================

        if (req.method === "GET" && pathname === "/health") {
            sendJSON(res, 200, {
                success: true,
                status: "online",
                service: "Iceland Transfer server"
            });

            return;
        }

        // ========================================
        // AVAILABILITY ENDPOINT
        // ========================================

        if (
            req.method === "GET" &&
            pathname === "/api/availability"
        ) {
            const date = cleanText(
                requestURL.searchParams.get("date"),
                10
            );

            const time = cleanText(
                requestURL.searchParams.get("time"),
                5
            );

            const serviceType = normalizeServiceType(
                requestURL.searchParams.get("service_type") ||
                requestURL.searchParams.get("service") ||
                ""
            );

            const durationHours = getServiceDuration(serviceType);

            if (!isValidDateString(date)) {
                sendJSON(res, 400, {
                    success: false,
                    code: "INVALID_DATE",
                    message:
                        "Please provide a valid date in YYYY-MM-DD format."
                });

                return;
            }

            if (!time) {
                const times = await getAvailableTimes(
                    date,
                    durationHours
                );

                sendJSON(res, 200, {
                    success: true,
                    date,
                    service_type: serviceType,
                    times,
                    availableTimes: times,
                    available_times: times,
                    availableSlots: times,
                    available_slots: times
                });

                return;
            }

            if (!isValidTimeString(time)) {
                sendJSON(res, 400, {
                    success: false,
                    code: "INVALID_TIME",
                    message: "Please provide a valid time."
                });

                return;
            }

            const [hour, minute] = time.split(":").map(Number);

            const requestedMinutes = hour * 60 + minute;

            if (
                !isFuturePickup(date, time) ||
                requestedMinutes < OPENING_HOUR * 60 ||
                requestedMinutes >= CLOSING_HOUR * 60 ||
                requestedMinutes + durationHours * 60 >
                    CLOSING_HOUR * 60
            ) {
                sendJSON(res, 200, {
                    success: true,
                    available: false,
                    remainingSlots: 0,
                    message:
                        "This time is outside the available booking period."
                });

                return;
            }

            const result = await checkAvailability(
                date,
                time,
                durationHours
            );

            sendJSON(res, 200, {
                success: true,
                date,
                time,
                ...result
            });

            return;
        }

        // ========================================
        // CREATE BOOKING ENDPOINT
        // ========================================

        if (
            req.method === "POST" &&
            pathname === "/api/bookings"
        ) {
            let body;

            try {
                body = await readBody(req);
            } catch (error) {
                sendJSON(res, 400, {
                    success: false,
                    code:
                        error.message === "REQUEST_TOO_LARGE"
                            ? "REQUEST_TOO_LARGE"
                            : "INVALID_JSON",
                    message:
                        "The request body is invalid or too large."
                });

                return;
            }

            try {
                const result = await createBooking(body);

                sendJSON(res, 201, result);
            } catch (error) {
                const status = error.status || 500;

                if (status === 500) {
                    console.error(
                        "Booking request failed:",
                        error.message || error
                    );
                }

                sendJSON(res, status, {
                    success: false,
                    code: error.code || "SERVER_ERROR",
                    message:
                        error.message ||
                        "Something went wrong. Please try again."
                });
            }

            return;
        }

        // ========================================
        // CANCEL BOOKING WITH TOKEN IN URL
        // ========================================

        const cancelPathMatch = pathname.match(
            /^\/api\/bookings\/cancel\/([^/]+)$/
        );

        if (req.method === "POST" && cancelPathMatch) {
            try {
                const token = decodeURIComponent(cancelPathMatch[1]);

                const result = await cancelBooking(token);

                sendJSON(res, 200, result);
            } catch (error) {
                const status = error.status || 500;

                if (status === 500) {
                    console.error(
                        "Cancellation request failed:",
                        error.message || error
                    );
                }

                sendJSON(res, status, {
                    success: false,
                    code: error.code || "SERVER_ERROR",
                    message:
                        error.message ||
                        "We could not cancel this booking."
                });
            }

            return;
        }

        // ========================================
        // CANCEL BOOKING WITH TOKEN IN BODY
        // ========================================

        if (
            req.method === "POST" &&
            pathname === "/api/bookings/cancel"
        ) {
            let body;

            try {
                body = await readBody(req);
            } catch {
                sendJSON(res, 400, {
                    success: false,
                    code: "INVALID_JSON",
                    message: "Invalid request body."
                });

                return;
            }

            try {
                const token = getValue(body, [
                    "cancellation_token",
                    "cancellationToken",
                    "token"
                ]);

                const result = await cancelBooking(token);

                sendJSON(res, 200, result);
            } catch (error) {
                const status = error.status || 500;

                if (status === 500) {
                    console.error(
                        "Cancellation request failed:",
                        error.message || error
                    );
                }

                sendJSON(res, status, {
                    success: false,
                    code: error.code || "SERVER_ERROR",
                    message:
                        error.message ||
                        "We could not cancel this booking."
                });
            }

            return;
        }

        // ========================================
        // NOT FOUND
        // ========================================

        sendJSON(res, 404, {
            success: false,
            code: "NOT_FOUND",
            message: "The requested endpoint was not found."
        });
    } catch (error) {
        console.error(
            "Unexpected server error:",
            error.message || error
        );

        sendJSON(res, 500, {
            success: false,
            code: "SERVER_ERROR",
            message: "An unexpected server error occurred."
        });
    }
});

// ========================================
// START SERVER
// ========================================

server.listen(PORT, () => {
    console.log(
        `Iceland Transfer server running on port ${PORT}`
    );
});