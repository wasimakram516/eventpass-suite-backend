exports.formatLocalDateTime = (date, timezone = null) => {
  if (!date) return "";

  const dateObj = new Date(date);

  const options = {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  };
  if (timezone) {
    return new Intl.DateTimeFormat("en-US", {
      ...options,
      timeZone: timezone,
    }).format(dateObj);
  }
  return dateObj.toLocaleString("en-US", options);
};

exports.getTimezoneLabel = (timezone) => {
  try {
    const now = new Date();
    const longName = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      timeZoneName: "long",
    })
      .formatToParts(now)
      .find((p) => p.type === "timeZoneName")?.value || timezone;

    const shortOffset = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      timeZoneName: "shortOffset",
    })
      .formatToParts(now)
      .find((p) => p.type === "timeZoneName")?.value || "";

    return shortOffset ? `${longName} (${shortOffset})` : longName;
  } catch {
    return timezone || "UTC";
  }
};
