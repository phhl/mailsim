function formatEmail({ username, courseName, domain }, env = {}) {
  const template = (env.MAIL_DOMAIN_TEMPLATE || "{course}.{domain}").trim();
  const course =
    courseName && courseName.trim() ? courseName.trim() : "default";
  const resolvedDomain = (domain || env.MAIL_DOMAIN || "local.test")
    .toString()
    .trim();
  const rendered = template
    .replaceAll("{course}", course)
    .replaceAll("{domain}", resolvedDomain);
  return `${username}@${rendered}`;
}

function formatLogin({ username, courseName, domain, role }, env = {}) {
  if (!username) return "";
  const useCourse =
    role === "student" ||
    (!!courseName && role !== "teacher" && role !== "schooladmin");
  if (useCourse) return formatEmail({ username, courseName, domain }, env);
  const resolvedDomain = (domain || env.MAIL_DOMAIN || "local.test")
    .toString()
    .trim();
  return resolvedDomain ? `${username}@${resolvedDomain}` : username;
}

module.exports = { formatEmail, formatLogin };
