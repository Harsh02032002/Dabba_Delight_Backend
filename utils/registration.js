/**
 * Self-service registration rules (POST /api/auth/register).
 * Admin and delivery accounts are never created here: admins come from setup scripts / the
 * admin panel, riders register through /api/partner/register.
 */
const SELF_REGISTER_ROLES = ['user', 'seller'];
const SELLER_TYPES = ['home_chef', 'cloud_kitchen', 'restaurant', 'catering'];
const MIN_PASSWORD_LENGTH = 6;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Indian mobile numbers: optional +91 / 91 / 0 prefix, then 10 digits starting 6-9 */
const normalizePhone = (phone) => {
  if (phone === undefined || phone === null) return '';
  const digits = String(phone).replace(/\D/g, '');
  const local = digits.length > 10 ? digits.slice(-10) : digits;
  return local;
};
const isValidPhone = (phone) => /^[6-9]\d{9}$/.test(normalizePhone(phone));

/**
 * Validate a registration request body.
 * @returns {{ ok: true, value: object } | { ok: false, status: number, message: string, field?: string }}
 */
const validateRegistration = (body = {}) => {
  const role = body.role === undefined || body.role === null || body.role === '' ? 'user' : String(body.role);
  if (!SELF_REGISTER_ROLES.includes(role)) {
    return { ok: false, status: 403, field: 'role', message: 'This account type cannot be created through registration' };
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (!name) return { ok: false, status: 400, field: 'name', message: 'Name is required' };
  if (!EMAIL_RE.test(email)) return { ok: false, status: 400, field: 'email', message: 'A valid email address is required' };
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, status: 400, field: 'password', message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` };
  }

  const hasPhone = body.phone !== undefined && body.phone !== null && String(body.phone).trim() !== '';
  if (hasPhone && !isValidPhone(body.phone)) {
    return { ok: false, status: 400, field: 'phone', message: 'Enter a valid 10-digit mobile number' };
  }

  // Phone is validated but stored as entered (SMS and login lookups already handle +91 formats)
  const value = { role, name, email, password, phone: hasPhone ? String(body.phone).trim() : undefined };

  if (role === 'seller') {
    const businessName = typeof body.businessName === 'string' ? body.businessName.trim() : '';
    if (!businessName) return { ok: false, status: 400, field: 'businessName', message: 'Business / kitchen name is required' };
    if (!hasPhone) return { ok: false, status: 400, field: 'phone', message: 'Phone number is required for sellers' };
    const type = body.type ? String(body.type).replace('-', '_') : 'home_chef';
    if (!SELLER_TYPES.includes(type)) return { ok: false, status: 400, field: 'type', message: 'Invalid business type' };
    value.businessName = businessName;
    value.type = type;
  }

  return { ok: true, value };
};

module.exports = { SELF_REGISTER_ROLES, SELLER_TYPES, MIN_PASSWORD_LENGTH, normalizePhone, isValidPhone, validateRegistration };
