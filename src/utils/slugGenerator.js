const slugify = (text) =>
    text
      .toString()
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  
  const generateUniqueSlug = async (Model, field = "slug", baseText) => {
    const baseSlug = slugify(baseText);
    let slug = baseSlug;
    let counter = 1;
  
    while (await Model.findOne({ [field]: slug })) {
      slug = `${baseSlug}-${counter}`;
      counter++;
    }
  
    return slug;
  };
  
  module.exports = { slugify, generateUniqueSlug };
  