module.exports = function sanitizeUser(user) {
  if (!user) return null;

  const { password, __v, ...safe } = user.toObject?.() || user;
  return safe;
};
