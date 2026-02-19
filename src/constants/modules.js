const BASE = [
  {
    key: "quiznest",
    labels: { en: "QuizNest", ar: "QuizNest" },
    descriptions: {
      en: "Create and manage single-player quiz games.",
      ar: "أنشئ وأدرِ اختبارات فردية تفاعلية.",
    },
    buttonsByRole: {
      admin: { en: "Manage Quizzes", ar: "إدارة الاختبارات" },
      staff: { en: "View Games", ar: "عرض الألعاب" },
    },
    icon: "quiz",
    color: "#0d47a1",
    routes: { admin: "/cms/modules/quiznest", staff: null },
  },
  {
    key: "eventduel",
    labels: { en: "Event Duel", ar: "Event Duel" },
    descriptions: {
      en: "Run real-time 1v1 quiz competitions.",
      ar: "تشغيل مسابقات مباشرة بين لاعبين.",
    },
    buttonsByRole: {
      admin: { en: "Launch Duels", ar: "تشغيل المبارزات" },
      staff: { en: "Host Dashboard", ar: "لوحة الاستضافة" },
    },
    icon: "games",
    color: "#5e35b1",
    routes: { admin: "/cms/modules/eventduel", staff: null },
  },
  {
    key: "tapmatch",
    labels: { en: "TapMatch", ar: "TapMatch" },
    descriptions: {
      en: "Create and manage interactive memory matching games.",
      ar: "أنشئ وأدرِ ألعاب مطابقة البطاقات التفاعلية.",
    },
    buttonsByRole: {
      admin: { en: "Manage TapMatch", ar: "إدارة اللعبة" },
      staff: { en: "View Matches", ar: "عرض الألعاب" },
    },
    icon: "grid",
    color: "#00897b",
    routes: { admin: "/cms/modules/tapmatch", staff: null },
  },
  {
    key: "eventreg",
    labels: { en: "Event Reg", ar: "Event Reg" },
    descriptionsByRole: {
      admin: {
        en: "Build custom registration forms for events.",
        ar: "إنشاء نماذج مخصصة لتسجيل الحضور.",
      },
      staff: {
        en: "Verify and manage event registrations.",
        ar: "التحقق من وإدارة تسجيلات الفعاليات.",
      },
    },
    buttonsByRole: {
      admin: { en: "Manage Forms", ar: "إدارة النماذج" },
      staff: { en: "Verify Registrations", ar: "التحقق من التسجيلات" },
    },
    icon: "assignment",
    color: "#006064",
    routes: { admin: "/cms/modules/eventreg", staff: "/staff/eventreg/verify" },
  },
  {
    key: "surveyguru",
    labels: { en: "SurveyGuru", ar: "SurveyGuru" },
    descriptions: {
      en: "Send a thank you or survey email to all attendees of a specific event.",
      ar: "أرسل رسالة شكر أو استبيانًا لجميع حضور فعالية محددة.",
    },
    buttonsByRole: {
      admin: { en: "Request Feedback", ar: "طلب الملاحظات" },
      staff: { en: "Not available", ar: "غير متاح" },
    },

    icon: "email",
    color: "#1565c0",
    routes: { admin: "/cms/modules/surveyguru", staff: null },
    requiresAdmin: true,
  },
  {
    key: "checkin",
    labels: { en: "Check-In", ar: "Check-In" },
    descriptionsByRole: {
      admin: {
        en: "Track and verify guest entries.",
        ar: "تتبع وتأكيد دخول الضيوف.",
      },
      staff: {
        en: "Verify and check-in guests at events.",
        ar: "التحقق من وتسجيل دخول الضيوف في الفعاليات.",
      },
    },
    buttonsByRole: {
      admin: { en: "Start Check-In", ar: "بدء تسجيل الدخول" },
      staff: { en: "Start Check-In", ar: "بدء تسجيل الدخول" },
    },
    icon: "checkin",
    color: "#0277bd",
    routes: { admin: "/cms/modules/checkin", staff: "/staff/checkin/verify" },
  },
  {
    key: "votecast",
    labels: { en: "VoteCast", ar: "VoteCast" },
    descriptions: {
      en: "Create and track audience polls.",
      ar: "إنشاء وتتبع استطلاعات الجمهور.",
    },
    buttonsByRole: {
      admin: { en: "View Polls", ar: "عرض التصويتات" },
      staff: { en: "Show Results", ar: "عرض النتائج" },
    },
    icon: "poll",
    color: "#00695c",
    routes: { admin: "/cms/modules/votecast", staff: null },
  },
  {
    key: "stageq",
    labels: { en: "StageQ", ar: "StageQ" },
    descriptions: {
      en: "Display visitor-submitted questions as bubbles.",
      ar: "عرض الأسئلة المقدمة من الزوار على الشاشة.",
    },
    buttonsByRole: {
      admin: { en: "Open Questions", ar: "فتح الأسئلة" },
      staff: { en: "Run Display", ar: "تشغيل العرض" },
    },
    icon: "forum",
    color: "#ef6c00",
    routes: { admin: "/cms/modules/stageq", staff: null },
  },
  {
    key: "mosaicwall",
    labels: { en: "MosaicWall", ar: "MosaicWall" },
    descriptions: {
      en: "Show photo & text submissions in real time.",
      ar: "عرض المشاركات النصية والصور في الوقت الفعلي.",
    },
    buttonsByRole: {
      admin: { en: "View Submissions", ar: "عرض المشاركات" },
      staff: { en: "Open Wall", ar: "فتح الحائط" },
    },
    icon: "image",
    color: "#4e342e",
    routes: { admin: "/cms/modules/mosaicwall", staff: null },
  },

  {
    key: "eventwheel",
    labels: { en: "Event Wheel", ar: "Event Wheel" },
    descriptions: {
      en: "Spin-to-win prize game for attendees.",
      ar: "تشغيل لعبة السحب للفوز بجوائز.",
    },
    buttonsByRole: {
      admin: { en: "Run Spin Wheel", ar: "تشغيل العجلة" },
      staff: { en: "Run Spin Wheel", ar: "تشغيل العجلة" },
    },
    icon: "trophy",
    color: "#c62828",
    routes: { admin: "/cms/modules/eventwheel", staff: null },
  },
  {
    key: "digipass",
    labels: { en: "DigiPass", ar: "DigiPass" },
    descriptionsByRole: {
      admin: {
        en: "Manage digital passes and track user activity completion.",
        ar: "إدارة التذاكر الرقمية وتتبع إتمام أنشطة المستخدمين.",
      },
      staff: {
        en: "Scan QR codes to verify users and track their activity completion.",
        ar: "امسح رموز QR للتحقق من المستخدمين وتتبع إتمام أنشطتهم.",
      },
    },
    buttonsByRole: {
      admin: { en: "Manage Passes", ar: "إدارة التذاكر" },
      staff: { en: "Scan QR Code", ar: "مسح رمز QR" },
    },
    icon: "badge",
    color: "#2e7d32",
    routes: { admin: "/cms/modules/digipass", staff: "/staff/digipass/verify" },
  },
];

// ---- helpers ----
function roleKey(role) {
  return ["admin", "business", "superadmin"].includes((role || "").toLowerCase())
    ? "admin"
    : "staff";
}

// Return modules for a role, leaving i18n objects intact for FE
function getModulesForRole(role = "admin") {
  const rk = roleKey(role);

  return BASE.map((m) => {
    const route = m.routes?.[rk]; // either string or null

    // hide if admin-only and not admin
    if (m.requiresAdmin && rk !== "admin") return null;

    // hide if this role's route is null
    if (!route) return null;

    const buttons = m.buttonsByRole?.[rk] ||
      m.buttonsByRole?.admin || { en: "Open", ar: "فتح" };

    const descriptions = m.descriptionsByRole?.[rk] ||
      m.descriptionsByRole?.admin ||
      m.descriptions ||
      { en: "", ar: "" };

    return {
      key: m.key,
      labels: m.labels,
      descriptions,
      buttons,
      icon: m.icon,
      color: m.color,
      route,
    };
  }).filter(Boolean);
}

const MODULES = getModulesForRole("admin");

module.exports = {
  getModulesForRole,
  MODULES,
};
