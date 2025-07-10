const MODULES = [
  {
    key: "quiznest",
    labels: {
      en: "QuizNest",
      ar: "QuizNest",
    },
    descriptions: {
      en: "Create and manage single-player quiz games.",
      ar: "أنشئ وأدرِ اختبارات فردية تفاعلية.",
    },
    buttons: {
      en: "Manage Quizzes",
      ar: "إدارة الاختبارات",
    },
    icon: "quiz",
    color: "#0d47a1",
    route: "/cms/modules/quiznest",
  },
  {
    key: "eventduel",
    labels: {
      en: "Event Duel",
      ar: "Event Duel",
    },
    descriptions: {
      en: "Run real-time 1v1 quiz competitions.",
      ar: "تشغيل مسابقات مباشرة بين لاعبين.",
    },
    buttons: {
      en: "Launch Duels",
      ar: "تشغيل المبارزات",
    },
    icon: "sports_esports",
    color: "#5e35b1",
    route: "/cms/modules/eventduel",
  },
  {
    key: "votecast",
    labels: {
      en: "VoteCast",
      ar: "VoteCast",
    },
    descriptions: {
      en: "Create and track audience polls.",
      ar: "إنشاء وتتبع استطلاعات الجمهور.",
    },
    buttons: {
      en: "View Polls",
      ar: "عرض التصويتات",
    },
    icon: "poll",
    color: "#00695c",
    route: "/cms/modules/votecast",
  },
  {
    key: "stageq",
    labels: {
      en: "StageQ",
      ar: "StageQ",
    },
    descriptions: {
      en: "Display visitor-submitted questions as bubbles.",
      ar: "عرض الأسئلة المقدمة من الزوار على الشاشة.",
    },
    buttons: {
      en: "Open Questions",
      ar: "فتح الأسئلة",
    },
    icon: "forum",
    color: "#ef6c00",
    route: "/cms/modules/stageq",
  },
  {
    key: "mosaicwall",
    labels: {
      en: "MosaicWall",
      ar: "MosaicWall",
    },
    descriptions: {
      en: "Show photo & text submissions in real time.",
      ar: "عرض المشاركات النصية والصور في الوقت الفعلي.",
    },
    buttons: {
      en: "View Submissions",
      ar: "عرض المشاركات",
    },
    icon: "image",
    color: "#4e342e",
    route: "/cms/modules/mosaicwall",
  },
  {
    key: "eventreg",
    labels: {
      en: "Event Reg",
      ar: "Event Reg",
    },
    descriptions: {
      en: "Build custom registration forms for events.",
      ar: "إنشاء نماذج مخصصة لتسجيل الحضور.",
    },
    buttons: {
      en: "Manage Forms",
      ar: "إدارة النماذج",
    },
    icon: "assignment",
    color: "#006064",
    route: "/cms/modules/eventreg",
  },
  {
    key: "checkin",
    labels: {
      en: "Check-In",
      ar: "Check-In",
    },
    descriptions: {
      en: "Track and verify guest entries.",
      ar: "تتبع وتأكيد دخول الضيوف.",
    },
    buttons: {
      en: "Start Check-In",
      ar: "بدء تسجيل الدخول",
    },
    icon: "how_to_reg",
    color: "#0277bd",
    route: "/cms/modules/checkin",
  },
  {
    key: "eventwheel",
    labels: {
      en: "Event Wheel",
      ar: "Event Wheel",
    },
    descriptions: {
      en: "Spin-to-win prize game for attendees.",
      ar: "تشغيل لعبة السحب للفوز بجوائز.",
    },
    buttons: {
      en: "Run Spin Wheel",
      ar: "تشغيل العجلة",
    },
    icon: "emoji_events",
    color: "#c62828",
    route: "/cms/modules/eventwheel",
  },
];

module.exports = { MODULES };
