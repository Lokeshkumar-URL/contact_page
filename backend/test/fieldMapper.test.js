import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FIELD_ALIASES, mapFields, normalizeFieldText } from '../src/services/browser/fieldMapper.js';

const profile = {
  firstName: 'Patrick', lastName: 'Joe', email: 'patrick@example.com', phone: '+1 555 0100',
  organization: 'Example Company', title: 'Growth Manager', streetAddress: '47 W 13th St',
  city: 'Claymont', state: 'DE', zipCode: '19703', message: 'Please send more information.',
};

const field = (index, overrides) => ({ index, selector: `#field-${index}`, tag: 'input', type: 'text', name: '', id: '', label: '', accessibleName: '', placeholder: '', autocomplete: '', ariaDescribedBy: '', required: false, disabled: false, readOnly: false, fillable: true, options: [], ...overrides });

test('normalization handles camelCase, underscores, punctuation, and accents', () => {
  assert.equal(normalizeFieldText('contactPerson_Name'), 'contact person name');
  assert.equal(normalizeFieldText('Téléphone / Mobile'), 'telephone mobile');
});

test('different website field names map to all approved profile values', () => {
  const fields = [
    field(0, { label: 'Given name' }),
    field(1, { accessibleName: 'Surname' }),
    field(2, { name: 'contactPerson' }),
    field(3, { name: 'workEmail', type: 'email' }),
    field(4, { label: 'Mobile No.', type: 'tel' }),
    field(5, { id: 'companyName' }),
    field(6, { label: 'Designation' }),
    field(7, { name: 'address_line_1' }),
    field(8, { placeholder: 'Town / City' }),
    field(9, { autocomplete: 'address-level1', tag: 'select', type: 'select' }),
    field(10, { accessibleName: 'Postcode' }),
    field(11, { tag: 'textarea', type: 'textarea', placeholder: 'Tell us about your project' }),
  ];
  const result = mapFields(fields, profile);
  const mapped = Object.fromEntries(result.mappings.map((mapping) => [mapping.fieldIndex, mapping]));
  assert.equal(mapped[0].profileKey, 'firstName'); assert.equal(mapped[0].value, 'Patrick');
  assert.equal(mapped[1].profileKey, 'lastName'); assert.equal(mapped[1].value, 'Joe');
  assert.equal(mapped[2].profileKey, 'fullName'); assert.equal(mapped[2].value, 'Patrick Joe');
  assert.equal(mapped[3].profileKey, 'email'); assert.equal(mapped[4].profileKey, 'phone');
  assert.equal(mapped[5].profileKey, 'organization'); assert.equal(mapped[6].profileKey, 'title');
  assert.equal(mapped[7].profileKey, 'streetAddress'); assert.equal(mapped[8].profileKey, 'city');
  assert.equal(mapped[9].profileKey, 'state'); assert.equal(mapped[10].profileKey, 'zipCode');
  assert.equal(mapped[11].profileKey, 'message'); assert.equal(result.unresolved.length, 0);
});

test('autocomplete and input types override weak or unusual website naming', () => {
  const result = mapFields([
    field(0, { name: 'x_183', autocomplete: 'given-name' }),
    field(1, { name: 'customer_input', type: 'email' }),
    field(2, { id: 'field_9', type: 'tel' }),
    field(3, { name: 'location_region', autocomplete: 'address-level1' }),
  ], profile);
  assert.deepEqual(result.mappings.map((mapping) => mapping.profileKey), ['firstName','email','phone','state']);
  assert.ok(result.mappings.every((mapping) => mapping.confidence === 'high'));
});

test('company name is not confused with personal name', () => {
  const result = mapFields([field(0, { label: 'Company Name', name: 'company_name' }), field(1, { label: 'Contact Person' })], profile);
  assert.equal(result.mappings[0].profileKey, 'organization');
  assert.equal(result.mappings[1].profileKey, 'fullName');
});

test('ambiguous, sensitive, consent, and unsupported fields are not auto-mapped', () => {
  const result = mapFields([
    field(0, { label: 'Subject' }),
    field(1, { label: 'Title' }),
    field(2, { label: 'Password', type: 'password' }),
    field(3, { label: 'I agree to marketing', type: 'checkbox' }),
    field(4, { label: 'Upload brief', type: 'file' }),
    field(5, { label: 'CAPTCHA response' }),
  ], profile);
  // Subject is now filled with the profile subject (default "Business Inquiry"); an ambiguous "Title" still is not.
  assert.deepEqual(result.mappings.map((item) => [item.field.index, item.profileKey, item.value]), [[0, 'subject', 'Business Inquiry']]);
  assert.deepEqual(result.unresolved.map((item) => item.field.index), [1]);
  assert.deepEqual(result.ignored.map((item) => item.field.index), [2,3,4,5]);
});

test('empty profile values remain unresolved instead of filling blank data', () => {
  const result = mapFields([field(0, { label: 'Your message', tag: 'textarea', type: 'textarea' })], { ...profile, message: '' });
  assert.equal(result.mappings.length, 0); assert.equal(result.unresolved[0].bestMatch, 'message');
});

test('alias dictionary has broad coverage for every requested field', () => {
  for (const key of ['firstName','lastName','fullName','email','phone','organization','title','streetAddress','city','state','zipCode','message']) {
    assert.ok(FIELD_ALIASES[key].length >= 12, `${key} should have broad aliases`);
  }
});

test('maps additional real-world contact field wording without Claude', () => {
  const cases = [
    ['customer_first_name','firstName'], ['contact_surname','lastName'], ['name_of_contact','fullName'],
    ['reply_to_email','email'], ['callback_number','phone'], ['practice_name','organization'],
    ['position_in_company','title'], ['location_address','streetAddress'], ['municipality','city'],
    ['state_or_province','state'], ['postalcode','zipCode'], ['support_request','message'],
  ];
  const result = mapFields(cases.map(([name], index) => field(index, { name, tag: name === 'support_request' ? 'textarea' : 'input' })), profile);
  assert.deepEqual(result.mappings.map((mapping) => mapping.profileKey), cases.map(([, key]) => key));
  assert.equal(result.unresolved.length, 0);
});

test('approved purpose and customer-status choices map without guessing', () => {
  const choiceProfile = { ...profile, contactPurpose: 'General inquiry', existingCustomer: 'No' };
  const result = mapFields([
    field(0, { tag: 'select', type: 'select', label: 'What can we help you with?', required: true, options: [{ value: 'general', text: 'General inquiry' }] }),
    field(1, { type: 'radio', label: 'No', groupLabel: 'Are you an existing customer?', required: true }),
  ], choiceProfile);
  assert.deepEqual(result.mappings.map((mapping) => mapping.profileKey), ['contactPurpose','existingCustomer']);
  assert.equal(result.unresolved.length, 0);
});

test('approved custom fields map extra website labels after built-in rules', () => {
  const customProfile={...profile,customFields:[{fieldName:'Practice size',aliases:'Number of locations, Office count',value:'1-5'}]};
  const result=mapFields([field(20,{label:'Number of locations',tag:'select',type:'select',required:true,options:[{value:'1-5',text:'1-5'}]})],customProfile);
  assert.equal(result.mappings[0].profileKey,'custom:0');assert.equal(result.mappings[0].value,'1-5');assert.equal(result.unresolved.length,0);
});
