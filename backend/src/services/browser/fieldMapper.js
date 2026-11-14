const AUTO_MAP_THRESHOLD = 60;
export const DEFAULT_SUBJECT = 'Business Inquiry';
export const DEFAULT_CONTACT_PURPOSE = 'General Inquiry';

const aliases = {
  firstName: [['first name',30],['firstname',30],['given name',30],['givenname',30],['forename',30],['contact first name',35],['contact given name',35],['your first name',35],['preferred first name',35],['requester first name',35],['customer first name',35],['client first name',35],['lead first name',35],['visitor first name',35],['sender first name',35],['fname',25]],
  lastName: [['last name',30],['lastname',30],['surname',30],['family name',30],['familyname',30],['family surname',30],['contact last name',35],['contact surname',35],['your last name',35],['requester last name',35],['customer last name',35],['client last name',35],['lead last name',35],['visitor last name',35],['sender last name',35],['lname',25]],
  fullName: [['full name',30],['your full name',35],['first and last name',35],['name and surname',35],['your name',30],['contact name',30],['contact person',35],['contact person name',35],['contactperson',35],['name of contact',35],['person to contact',35],['person name',25],['representative name',25],['primary contact',25],['requester name',30],['customer name',30],['client name',30],['sender name',30],['visitor name',30],['applicant name',30],['authorized contact',30],['authorised contact',30],['name',10]],
  email: [['email address',30],['email',30],['e mail',30],['email id',30],['emailid',30],['mail address',25],['work email',35],['work e mail',35],['business email',35],['business e mail',35],['company email',35],['contact email',35],['contact e mail',35],['your email',35],['your email address',35],['reply email',30],['reply to email',30],['sender email',30],['preferred email',30],['corporate email',30],['electronic mail',25]],
  phone: [['phone number',30],['phone no',30],['telephone number',30],['telephone no',30],['tel number',30],['tel no',30],['contact number',30],['contact phone',35],['mobile number',30],['mobile no',30],['phone',30],['telephone',30],['mobile',30],['cell phone',30],['cellphone',30],['work phone',35],['office phone',30],['business phone',35],['company phone',35],['primary phone',30],['daytime phone',30],['direct line',30],['callback number',35],['call back number',35],['whatsapp number',30],['tel',25]],
  organization: [['company name',35],['organization name',35],['organisation name',35],['business name',35],['company or organization',40],['company or organisation',40],['company organisation',35],['practice name',35],['clinic name',35],['office name',30],['facility name',30],['agency name',30],['institution name',30],['school name',30],['brand name',30],['legal business name',35],['account name',25],['your company',35],['company',30],['organization',30],['organisation',30],['business',25],['employer',25],['agency',25],['firm',25],['institution',25],['workplace',20],['org',20]],
  title: [['job title',35],['position title',30],['professional title',30],['work title',30],['job position',35],['position in company',35],['role at company',35],['designation',30],['position',25],['job role',30],['professional role',25],['department role',25],['your role',25],['occupation',25],['profession',20],['business function',25],['role',15],['title',5]],
  streetAddress: [['street address',35],['street address 1',35],['address line 1',35],['address line one',35],['address line',30],['address1',30],['mailing address',30],['business address',30],['company address',30],['office address',30],['contact address',30],['location address',30],['physical address',25],['postal address',25],['house address',25],['road address',25],['street',20],['address',15]],
  city: [['city town',35],['town city',35],['city name',35],['town name',35],['business city',35],['contact city',35],['city',30],['town',30],['locality',30],['municipality',30],['suburb',30],['address level2',30],['address level 2',30]],
  state: [['state province',35],['province state',35],['state or province',40],['province or state',40],['state name',35],['province name',35],['business state',35],['contact state',35],['administrative area',30],['state',30],['province',30],['region',20],['territory',20],['county',15],['address level1',30],['address level 1',30]],
  zipCode: [['zip code',35],['zipcode',35],['zip postal code',40],['postal zip code',40],['postal code',35],['postalcode',35],['postcode',35],['post code',35],['pin code',30],['pincode',30],['area postal code',30],['business postal code',35],['contact postal code',35],['postal',20],['zip',25]],
  message: [['your message',35],['message body',35],['contact message',35],['request message',35],['message',30],['comments',25],['your comments',30],['comment',20],['enquiry details',35],['inquiry details',35],['enquiry',30],['inquiry',30],['project details',35],['project description',35],['request details',30],['support request',30],['reason for contact',40],['tell us about your project',40],['tell us how we can help',40],['tell us more',35],['how can we help',35],['how may we help',35],['what can we help with',35],['question or comment',35],['description',20],['requirements',25],['additional information',25],['additional details',25],['details',15],['notes',15],['question',15],['brief',15]],
  contactPurpose: [['contact purpose',40],['reason for contact',40],['contact reason',40],['what can we help you with',45],['how can we help you',40],['inquiry type',40],['enquiry type',40],['request type',35],['contact type',35],['topic',30],['department',30],['service interested in',40],['service of interest',40],['nature of inquiry',40],['nature of enquiry',40],['area of interest',35]],
  subject: [['subject',40],['message subject',45],['email subject',45],['subject line',45],['subject of inquiry',45],['subject of enquiry',45],['inquiry subject',45],['enquiry subject',45],['regarding',30],['topic of your message',40]],
  existingCustomer: [['existing customer',45],['current customer',40],['already a customer',45],['are you a customer',45],['are you an existing customer',45],['customer status',40],['existing client',40],['current client',40],['already a client',40],['client status',35],['existing patient',40],['current patient',40]],
};

const autocompleteMap = { 'given-name':'firstName','family-name':'lastName','name':'fullName','email':'email','tel':'phone','organization':'organization','organization-title':'title','street-address':'streetAddress','address-line1':'streetAddress','address-level2':'city','address-level1':'state','postal-code':'zipCode' };
const ignoredTypes = new Set(['hidden','password','file','submit','button','reset','image']);
const sensitivePattern = /captcha|recaptcha|hcaptcha|turnstile|password|passcode|consent|agree|terms|privacy|newsletter|subscribe|marketing|opt[ -]?in/;
const negativeByKey = {
  firstName: /company|business|organization|organisation/, lastName: /company|business|organization|organisation/,
  fullName: /company|business|organization|organisation|cardholder/, title: /subject|salutation|prefix|mr\.?|mrs\.?|miss|ms\.?/,
  streetAddress: /email|web|ip address/, city: /citizenship/, state: /statement|estate/, zipCode: /area code|phone/,
  subject: /captcha|e ?mail|name|phone|company/,
  message: /subject|title|captcha|reason for contact|contact purpose|inquiry type|enquiry type|what can we help you with/,
};

export function normalizeFieldText(value) {
  return String(value ?? '').replace(/([a-z0-9])([A-Z])/g,'$1 $2').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
}

function fieldSignals(field) {
  return [
    ['label', field.label, 50], ['accessibleName', field.accessibleName, 48], ['placeholder', field.placeholder, 38],
    ['groupLabel', field.groupLabel, 52], ['name', field.name, 30], ['id', field.id, 28], ['ariaDescribedBy', field.ariaDescribedBy, 18],
  ].map(([source,value,weight])=>({source,text:normalizeFieldText(value),weight})).filter((signal)=>signal.text);
}

function scoreKey(field, key, signals) {
  const combined = signals.map((signal)=>signal.text).join(' ');
  if (negativeByKey[key]?.test(combined)) return { score: -100, matchedBy: [] };
  let best = { score: 0, matchedBy: [] };
  for (const signal of signals) for (const [phrase,strength] of aliases[key]) {
    const normalizedPhrase=normalizeFieldText(phrase); let score=0;
    if(signal.text===normalizedPhrase) score=signal.weight+strength;
    else if(signal.text.includes(normalizedPhrase)) score=Math.round(signal.weight*.7)+strength;
    if(score>best.score) best={score,matchedBy:[`${signal.source}:${phrase}`]};
  }
  const type=normalizeFieldText(field.type);
  if(key==='email'&&type==='email') { best.score=Math.max(110,best.score+55); best.matchedBy.push('type:email'); }
  if(key==='phone'&&(type==='tel'||type==='telephone')) { best.score=Math.max(110,best.score+55); best.matchedBy.push('type:tel'); }
  if(key==='message'&&field.tag==='textarea') { best.score+=22; best.matchedBy.push('tag:textarea'); }
  return best;
}

function customFieldDefinitions(profile = {}) {
  return (Array.isArray(profile.customFields) ? profile.customFields : []).map((definition, index) => ({
    ...definition, index, value: definition?.value, phrases: [definition?.fieldName, ...String(definition?.aliases ?? '').split(/[,|\n]/)].map(normalizeFieldText).filter(Boolean),
  })).filter((definition) => definition.phrases.length && definition.value !== undefined && definition.value !== null && String(definition.value).trim());
}

function matchCustomField(signals, profile) {
  let best = null;
  for (const definition of customFieldDefinitions(profile)) for (const signal of signals) for (const phrase of definition.phrases) {
    let score = 0;
    if (signal.text === phrase) score = signal.weight + 40;
    else if (phrase.length >= 4 && signal.text.includes(phrase)) score = Math.round(signal.weight * .7) + 35;
    if (!best || score > best.score) best = { definition, score, matchedBy: [`custom:${signal.source}:${phrase}`] };
  }
  return best?.score >= AUTO_MAP_THRESHOLD ? best : null;
}

export function getProfileValues(profile) {
  return { ...profile, fullName: profile.fullName?.trim() || [profile.firstName,profile.lastName].filter(Boolean).join(' ').trim(), message: profile.message ?? profile.approvedMessage ?? '', subject: profile.subject?.trim() || DEFAULT_SUBJECT, contactPurpose: profile.contactPurpose?.trim() || DEFAULT_CONTACT_PURPOSE };
}

function ignoreReason(field) {
  const type=normalizeFieldText(field.type); const text=fieldSignals(field).map((signal)=>signal.text).join(' ');
  if(!field.fillable||field.disabled||field.readOnly||ignoredTypes.has(type)) return 'not-fillable';
  if(field.isCaptcha) return 'captcha';
  if(sensitivePattern.test(text)) return 'sensitive-or-consent';
  if(type==='checkbox') return 'choice-requires-policy';
  return null;
}

export function mapFields(fields=[],profile={}) {
  const values=getProfileValues(profile); const mappings=[]; const unresolved=[]; const ignored=[];
  for(const field of fields){
    const reason=ignoreReason(field); if(reason){ignored.push({field,reason});continue;}
    const autocomplete=normalizeFieldText(field.autocomplete).replace(/ /g,'-'); const autocompleteKey=autocompleteMap[autocomplete];
    let winner=autocompleteKey?{key:autocompleteKey,score:140,matchedBy:[`autocomplete:${autocomplete}`]}:null;
    const signals=fieldSignals(field);
    if(!winner){ for(const key of Object.keys(aliases)){const result=scoreKey(field,key,signals);if(!winner||result.score>winner.score)winner={key,...result};} }
    if(!winner||winner.score<AUTO_MAP_THRESHOLD||!values[winner.key]){
      const custom=matchCustomField(signals,profile);
      if(custom){mappings.push({fieldIndex:field.index,selector:field.selector,field,profileKey:`custom:${custom.definition.index}`,value:custom.definition.value,score:custom.score,confidence:custom.score>=100?'high':custom.score>=75?'medium':'low',matchedBy:custom.matchedBy});continue;}
      unresolved.push({field,bestMatch:winner?.key??null,score:winner?.score??0});continue;
    }
    mappings.push({fieldIndex:field.index,selector:field.selector,field,profileKey:winner.key,value:values[winner.key],score:winner.score,confidence:winner.score>=100?'high':winner.score>=75?'medium':'low',matchedBy:winner.matchedBy});
  }
  return {mappings,unresolved,ignored};
}

export const FIELD_ALIASES=Object.freeze(aliases);
