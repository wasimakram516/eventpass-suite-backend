const asyncHandler = require("../../middlewares/asyncHandler");
const response = require("../../utils/response");
const Registration = require("../../models/Registration");
const Event = require("../../models/Event");
const SurveyRecipient = require("../../models/SurveyRecipient");
const SurveyForm = require("../../models/SurveyForm");
const SurveyResponse = require("../../models/SurveyResponse");
const SpinWheelParticipant = require("../../models/SpinWheelParticipant");
const SpinWheel = require("../../models/SpinWheel");
const Visitor = require("../../models/Visitor");
const Player = require("../../models/Player");
const GameSession = require("../../models/GameSession");
const Game = require("../../models/Game");
const {
  pickFullName,
  pickEmail,
  pickPhone,
  pickCompany,
} = require("../../utils/customFieldUtils");
const {
  COUNTRY_CODES,
  getCountryByIsoCode,
  getCountryByCode,
  combinePhoneWithCountryCode,
  extractCountryCodeAndIsoCode,
} = require("../../utils/countryCodes");

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getMatchingIsoCodes(term) {
  const t = term.toLowerCase().trim();
  const byName = COUNTRY_CODES.filter((cc) =>
    (cc.country || "").toLowerCase().includes(t)
  ).map((cc) => cc.isoCode);
  const direct = t.length <= 3 && COUNTRY_CODES.some((cc) => cc.isoCode === t)
    ? [t]
    : [];
  let byCode = [];
  const codeLike = String(term).trim();
  if (codeLike.startsWith("+") || /^\d+$/.test(codeLike)) {
    const normalized = codeLike.startsWith("+") ? codeLike : `+${codeLike}`;
    const country = getCountryByCode(normalized);
    if (country) byCode = [country.isoCode];
  }
  return [...new Set([...byName, ...direct, ...byCode])];
}

function notDeletedMatch() {
  return {
    $or: [{ isDeleted: false }, { isDeleted: { $exists: false } }],
  };
}

function stringFieldMatches(field, regex) {
  return {
    $and: [
      { [field]: { $exists: true, $type: "string" } },
      { [field]: regex },
    ],
  };
}

function formatPhoneForDisplay(localNumber, isoCode) {
  if (!localNumber || String(localNumber).trim() === "") return "-";
  const combined = combinePhoneWithCountryCode(String(localNumber).trim(), isoCode);
  return combined || localNumber || "-";
}

function rowContainsTerm(row, term) {
  const t = term.toLowerCase();
  const fullName = (row.fullName && String(row.fullName).toLowerCase()) || "";
  const company = (row.company && String(row.company).toLowerCase()) || "";
  const phone = (row.phone && String(row.phone).toLowerCase()) || "";
  const email = (row.email && String(row.email).toLowerCase()) || "";
  const country = (row.country && String(row.country).toLowerCase()) || "";
  return fullName.includes(t) || company.includes(t) || phone.includes(t) || email.includes(t) || country.includes(t);
}

async function searchRegistrations(regex, matchingIsoCodes, escapedTerm) {
  const pipeline = [
    {
      $addFields: {
        _cfArr: {
          $ifNull: [
            {
              $cond: [
                { $eq: [{ $type: "$customFields" }, "object"] },
                { $objectToArray: "$customFields" },
                [],
              ],
            },
            [],
          ],
        },
      },
    },
    {
      $match: {
        $or: [
          { fullName: regex },
          { email: regex },
          { phone: regex },
          { company: regex },
          { isoCode: { $in: matchingIsoCodes } },
          {
            "_cfArr.v": {
              $regex: escapedTerm,
              $options: "i",
            },
          },
        ],
      },
    },
    {
      $lookup: {
        from: "events",
        localField: "eventId",
        foreignField: "_id",
        as: "_event",
        pipeline: [
          { $match: notDeletedMatch() },
          { $project: { name: 1, eventType: 1 } },
        ],
      },
    },
    { $unwind: { path: "$_event", preserveNullAndEmptyArrays: true } },
    {
      $project: {
        fullName: 1,
        email: 1,
        phone: 1,
        company: 1,
        customFields: 1,
        isoCode: 1,
        createdAt: 1,
        eventName: { $ifNull: ["$_event.name", "-"] },
        eventType: "$_event.eventType",
      },
    },
  ];
  const regs = await Registration.aggregate(pipeline).exec();
  const moduleByType = {
    public: "Event Reg",
    closed: "Check-in",
    digipass: "DigiPass",
  };
  return regs.map((r) => {
    const cf = r.customFields && typeof r.customFields === "object"
      ? (r.customFields instanceof Map ? Object.fromEntries(r.customFields) : r.customFields)
      : {};
    const fullName = r.fullName || pickFullName(cf) || "-";
    const email = r.email || pickEmail(cf) || "-";
    const rawPhone = r.phone || pickPhone(cf) || null;
    const company = r.company || pickCompany(cf) || "-";
    const moduleName = moduleByType[r.eventType] || "Event Reg";
    const countryName = (r.isoCode && getCountryByIsoCode(r.isoCode)?.country) || "-";
    const phoneDisplay = formatPhoneForDisplay(rawPhone, r.isoCode);
    return {
      fullName: fullName || "-",
      company: company || "-",
      phone: phoneDisplay,
      email: email || "-",
      country: countryName,
      itemType: "Registration",
      module: moduleName,
      eventName: r.eventName || "-",
      time: r.createdAt,
    };
  });
}

async function searchSurveyRecipients(regex) {
  const recipients = await SurveyRecipient.find({
    $or: [
      stringFieldMatches("fullName", regex),
      stringFieldMatches("email", regex),
      stringFieldMatches("company", regex),
    ],
  })
    .select("fullName email company createdAt formId")
    .lean();
  if (recipients.length === 0) return [];
  const formIds = [...new Set(recipients.map((r) => r.formId?.toString()).filter(Boolean))];
  const forms = await SurveyForm.find({ _id: { $in: formIds } })
    .select("title")
    .lean();
  const formTitleById = {};
  forms.forEach((f) => {
    formTitleById[f._id.toString()] = f.title || "-";
    return null;
  });
  return recipients.map((r) => ({
    fullName: r.fullName || "-",
    company: r.company || "-",
    phone: "-",
    email: r.email || "-",
    country: "-",
    itemType: "SurveyRecipient",
    module: "SurveyGuru",
    eventName: formTitleById[r.formId?.toString()] || "-",
    time: r.createdAt,
  }));
}

async function searchSurveyResponses(regex) {
  const responses = await SurveyResponse.find({
    $or: [
      stringFieldMatches("attendee.name", regex),
      stringFieldMatches("attendee.email", regex),
      stringFieldMatches("attendee.company", regex),
    ],
  })
    .select("attendee.name attendee.email attendee.company createdAt formId")
    .lean();

  if (responses.length === 0) return [];

  const formIds = [
    ...new Set(
      responses
        .map((r) => r.formId && r.formId.toString())
        .filter(Boolean)
    ),
  ];

  let formTitleById = {};

  if (formIds.length > 0) {
    const forms = await SurveyForm.find({ _id: { $in: formIds } })
      .select("title")
      .lean();

    formTitleById = forms.reduce((acc, f) => {
      acc[f._id.toString()] = f.title || "-";
      return acc;
    }, {});
  }

  return responses.map((r) => {
    const attendee = r.attendee || {};
    return {
      fullName: attendee.name || "-",
      company: attendee.company || "-",
      phone: "-",
      email: attendee.email || "-",
      country: "-",
      itemType: "SurveyResponse",
      module: "SurveyGuru",
      eventName: formTitleById[r.formId?.toString()] || "-",
      time: r.createdAt,
    };
  });
}

async function searchSpinWheelParticipants(regex, matchingIsoCodes) {
  const orConditions = [
    stringFieldMatches("name", regex),
    stringFieldMatches("phone", regex),
    stringFieldMatches("company", regex),
  ];

  if (matchingIsoCodes && matchingIsoCodes.length > 0) {
    orConditions.push({ isoCode: { $in: matchingIsoCodes } });
  }

  const participants = await SpinWheelParticipant.find({
    $or: orConditions,
  })
    .select("name phone isoCode company createdAt spinWheel")
    .lean();
  if (participants.length === 0) return [];
  const wheelIds = [...new Set(participants.map((p) => p.spinWheel?.toString()).filter(Boolean))];
  const wheels = await SpinWheel.find({ _id: { $in: wheelIds } })
    .select("title")
    .lean();
  const titleById = {};
  wheels.forEach((w) => {
    titleById[w._id.toString()] = w.title || "-";
    return null;
  });
  return participants.map((p) => ({
    fullName: p.name || "-",
    company: p.company || "-",
    phone: formatPhoneForDisplay(p.phone, p.isoCode),
    email: "-",
    country:
      (p.isoCode && getCountryByIsoCode(p.isoCode)?.country) || "-",
    itemType: "SpinWheelParticipant",
    module: "Event Wheel",
    eventName: titleById[p.spinWheel?.toString()] || "-",
    time: p.createdAt,
  }));
}

async function searchVisitors(regex) {
  const visitors = await Visitor.find({
    $or: [
      stringFieldMatches("name", regex),
      stringFieldMatches("phone", regex),
      stringFieldMatches("company", regex),
    ],
  })
    .select("name phone company createdAt")
    .lean();
  return visitors.map((v) => ({
    fullName: v.name || "-",
    company: v.company || "-",
    phone: v.phone || "-",
    email: "-",
    country: "-",
    itemType: "Visitor",
    module: "StageQ",
    eventName: "-",
    time: v.createdAt,
  }));
}

function gameModuleFromGame(game) {
  if (!game) return "Game";
  if (game.mode === "pvp") return "EventDuel";
  if (game.type === "memory") return "TapMatch";
  return "QuizNest";
}

async function searchPlayers(regex) {
  const players = await Player.find({
    $or: [
      stringFieldMatches("name", regex),
      stringFieldMatches("company", regex),
      stringFieldMatches("phone", regex),
    ],
  })
    .select("name company phone createdAt sessionId")
    .lean();
  if (players.length === 0) return [];
  const sessionIds = [...new Set(players.map((p) => p.sessionId?.toString()).filter(Boolean))];
  const sessions = await GameSession.find({ _id: { $in: sessionIds } })
    .select("gameId")
    .lean();
  const gameIds = [...new Set(sessions.map((s) => s.gameId?.toString()).filter(Boolean))];
  const games = await Game.find({ _id: { $in: gameIds } })
    .select("title type mode")
    .lean();
  const gameById = {};
  games.forEach((g) => {
    gameById[g._id.toString()] = g;
    return null;
  });
  const sessionToGame = {};
  sessions.forEach((s) => {
    sessionToGame[s._id.toString()] = gameById[s.gameId?.toString()];
    return null;
  });
  return players.map((p) => {
    const game = p.sessionId ? sessionToGame[p.sessionId.toString()] : null;
    const moduleName = gameModuleFromGame(game);
    const eventName = game?.title || "-";
    return {
      fullName: p.name || "-",
      company: p.company || "-",
      phone: p.phone || "-",
      email: "-",
      country: "-",
      itemType: "Player",
      module: moduleName,
      eventName,
      time: p.createdAt,
    };
  });
}

exports.globalSearch = asyncHandler(async (req, res) => {
  const q = (req.query.q || req.body.q || "").toString().trim();
  if (!q) {
    return response(res, 400, "Search query is required", []);
  }
  let searchTerms = [q];
  if (q.startsWith("+")) {
    const parsed = extractCountryCodeAndIsoCode(q);
    if (parsed.localNumber && String(parsed.localNumber).trim()) {
      searchTerms.push(String(parsed.localNumber).trim());
    }
  }
  const escapedTerm = searchTerms.map((t) => escapeRegex(t)).join("|");
  const regex = new RegExp(escapedTerm, "i");
  const matchingIsoCodes = getMatchingIsoCodes(q);

  const [
    regResults,
    surveyRecipientResults,
    surveyResponseResults,
    wheelResults,
    visitorResults,
    playerResults,
  ] = await Promise.all([
    searchRegistrations(regex, matchingIsoCodes, escapedTerm),
    searchSurveyRecipients(regex),
    searchSurveyResponses(regex),
    searchSpinWheelParticipants(regex, matchingIsoCodes),
    searchVisitors(regex),
    searchPlayers(regex),
  ]);

  let combined = [
    ...regResults,
    ...surveyRecipientResults,
    ...surveyResponseResults,
    ...wheelResults,
    ...visitorResults,
    ...playerResults,
  ];
  combined = combined.filter((row) => rowContainsTerm(row, q));
  combined.sort((a, b) => new Date(b.time) - new Date(a.time));

  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  return response(res, 200, "OK", { results: combined });
});
