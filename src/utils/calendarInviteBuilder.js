const env = require("../config/env");

/**
 * Parses "Display Name <email@domain.com>" → { name, email }
 * Falls back to raw string as email if no angle-bracket format found.
 */
function parseFromAddress(from) {
  const match = from && from.match(/^(.+?)\s*<([^>]+)>$/);
  if (match) return { name: match[1].trim(), email: match[2].trim() };
  return { name: "", email: (from || "").trim() };
}

const { name: organizerName, email: organizerEmail } = parseFromAddress(
  env.notifications.email.from
);

/**
 * Builds an ICS (iCalendar) string for a calendar invite.
 *
 * Combines event.startDate + event.startTime (HH:mm) to produce a VTIMEZONE-aware
 * DTSTART/DTEND. Falls back to 00:00 if no time string is provided.
 *
 * @param {Object} event
 * @param {string} event.name
 * @param {Date}   event.startDate
 * @param {Date}   event.endDate
 * @param {string} [event.startTime]   - "HH:mm"
 * @param {string} [event.endTime]     - "HH:mm"
 * @param {string} [event.timezone]    - IANA timezone, default "Asia/Muscat"
 * @param {string} [event.venue]
 * @param {string} [event.description]
 * @param {string} uid                 - Unique string per recipient (e.g. registration._id)
 * @param {string} [attendeeEmail]     - Registrant's email address
 * @returns {string}
 */
function buildCalendarInvite(event, uid, attendeeEmail) {
  const tz = event.timezone || "Asia/Muscat";
  const hasTime = !!(event.startTime && /^\d{1,2}:\d{2}$/.test(event.startTime));

  const dtStamp = formatUtcNow();
  const summary = escapeIcsText(event.name || "Event");
  const location = escapeIcsText(event.venue || "");
  const description = escapeIcsText(event.description || "");

  let dtStartLine, dtEndLine;

  if (hasTime) {
    // Timed event — use TZID with local datetime
    const dtStart = buildDtString(event.startDate, event.startTime);
    const dtEnd = buildDtString(event.endDate, event.endTime || event.startTime);
    dtStartLine = `DTSTART;TZID=${tz}:${dtStart}`;
    dtEndLine = `DTEND;TZID=${tz}:${dtEnd}`;
  } else {
    // All-day event — use VALUE=DATE (no time, no timezone)
    dtStartLine = `DTSTART;VALUE=DATE:${buildDateOnly(event.startDate)}`;
    // DTEND for all-day is exclusive (day after last day)
    dtEndLine = `DTEND;VALUE=DATE:${buildDateOnlyPlusOne(event.endDate)}`;
  }

  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//EventPass Suite//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${uid}@eventpass`,
    `DTSTAMP:${dtStamp}`,
    dtStartLine,
    dtEndLine,
    `SUMMARY:${summary}`,
    (event.organizerEmail || organizerEmail)
      ? `ORGANIZER;CN="${event.organizerName || event.organizerEmail || organizerName || organizerEmail}":mailto:${event.organizerEmail || organizerEmail}`
      : null,
    attendeeEmail
      ? `ATTENDEE;CN="${attendeeEmail}";RSVP=TRUE:mailto:${attendeeEmail}`
      : null,
    location ? `LOCATION:${location}` : null,
    description ? `DESCRIPTION:${description}` : null,
    "STATUS:CONFIRMED",
    "SEQUENCE:0",
    "END:VEVENT",
    "END:VCALENDAR",
  ]
    .filter(Boolean)
    .join("\r\n");

  return ics;
}

/**
 * Combines a Date object and an optional "HH:mm" time string into an ICS
 * local datetime string: "YYYYMMDDTHHmmss"
 */
function buildDtString(date, timeStr) {
  if (!date) return formatUtcNow(); // fallback — should not happen

  const d = new Date(date);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");

  let hours = "00";
  let minutes = "00";

  if (timeStr && /^\d{1,2}:\d{2}$/.test(timeStr)) {
    const parts = timeStr.split(":");
    hours = String(parts[0]).padStart(2, "0");
    minutes = String(parts[1]).padStart(2, "0");
  }

  return `${year}${month}${day}T${hours}${minutes}00`;
}

/** Returns "YYYYMMDD" for all-day DTSTART */
function buildDateOnly(date) {
  const d = new Date(date);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

/** Returns "YYYYMMDD" for all-day DTEND (exclusive — day after endDate) */
function buildDateOnlyPlusOne(date) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + 1);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

/** UTC timestamp for DTSTAMP: "YYYYMMDDTHHmmssZ" */
function formatUtcNow() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const mo = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const h = String(now.getUTCHours()).padStart(2, "0");
  const mi = String(now.getUTCMinutes()).padStart(2, "0");
  const s = String(now.getUTCSeconds()).padStart(2, "0");
  return `${y}${mo}${d}T${h}${mi}${s}Z`;
}

/** Escapes special characters in ICS text values */
function escapeIcsText(str) {
  return String(str)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "");
}

module.exports = { buildCalendarInvite };
