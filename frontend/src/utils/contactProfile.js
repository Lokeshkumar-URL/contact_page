export const DEFAULT_CONTACT_PROFILE = Object.freeze({
  firstName: 'Patrick',
  lastName: 'Joe',
  title: 'Senior Growth Associate',
  email: 'patrick@listsassistant.com',
  organization: 'Listsassistant.com',
  phone: '+1 904-747-9442',
  streetAddress: '47 W 13th St',
  city: 'Claymont',
  state: 'DE',
  zipCode: '19703',
  message: '',
});

const requiredFields = {
  firstName: 'First name',
  lastName: 'Last name',
  email: 'Email',
  organization: 'Organization',
  phone: 'Phone',
  message: 'Approved message',
};

export function validateContactProfile(profile) {
  const errors = {};

  for (const [field, label] of Object.entries(requiredFields)) {
    if (!profile[field]?.trim()) errors[field] = `${label} is required.`;
  }

  if (profile.email?.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email.trim())) {
    errors.email = 'Enter a valid email address.';
  }

  const phoneDigits = profile.phone?.replace(/\D/g, '') ?? '';
  if (profile.phone?.trim() && (phoneDigits.length < 7 || phoneDigits.length > 15)) {
    errors.phone = 'Enter a phone number with 7 to 15 digits.';
  }

  if ((profile.message?.length ?? 0) > 1000) {
    errors.message = 'Approved message must be 1,000 characters or fewer.';
  }

  return errors;
}

export function normalizeContactProfile(profile) {
  return Object.fromEntries(
    Object.entries(profile).map(([field, value]) => [field, typeof value === 'string' ? value.trim() : value]),
  );
}
