exports.buildBadgeZpl = function ({ eventName, fullName, company, token }) {
  return `
^XA
^CI28
^PW600
^LL1200

^FO0,80^A0N,40,40^FB600,2,0,C,0^FD${eventName || "Event"}^FS

^FO0,200^A0N,80,80^FB600,2,0,C,0^FD${fullName}^FS

^FO0,390^A0N,40,40^FB600,3,0,C,0^FD${company || ""}^FS

^FO90,500
^BQN,2,20
^FDLA,${token}^FS

^FO30,1000^GB540,2,2^FS
^FO0,1030^A0N,38,48^FB600,2,0,C,0^FDPowered by EventPass^FS

^XZ
`.trim();
};
