const AUTO_MAP_THRESHOLD = 60;

const aliases = {
  firstName: [['first name',30],['firstname',30],['given name',30],['givenname',30],['forename',30],['contact first name',35],['your first name',35],['fname',25]],
  lastName: [['last name',30],['lastname',30],['surname',30],['family name',30],['familyname',30],['contact last name',35],['your last name',35],['lname',25]],
  fullName: [['full name',30],['your name',30],['contact name',30],['contact person',35],['contactperson',35],['person name',25],['representative name',25],['primary contact',25],['name',10]],
  email: [['email address',30],['email',30],['e mail',30],['work email',35],['business email',35],['contact email',35],['corporate email',30],['electronic mail',25]],
  phone: [['phone number',30],['telephone number',30],['contact number',30],['mobile number',30],['phone',30],['telephone',30],['mobile',30],['cell phone',30],['cellphone',30],['work phone',35],['office phone',30],['direct line',30],['tel',25]],
  organization: [['company name',35],['organization name',35],['organisation name',35],['business name',35],['company',30],['organization',30],['organisation',30],['business',25],['employer',25],['agency',25],['firm',25],['institution',25],['workplace',20],['org',20]],
  title: [['job title',35],['position title',30],['designation',30],['position',25],['job role',30],['professional role',25],['occupation',25],['profession',20],['role',15],['title',5]],
  streetAddress: [['street address',35],['address line 1',35],['address1',30],['mailing address',30],['business address',30],['office address',30],['physical address',25],['postal address',25],['street',20],['address',15]],
  city: [['city town',35],['town city',35],['city',30],['town',25],['locality',25],['municipality',25],['address level2',30],['address level 2',30]],
  state: [['state province',30],['state',30],['province',30],['region',20],['territory',20],['county',15],['address level1',30],['address level 1',30]],
  zipCode: [['zip code',35],['zipcode',35],['postal code',35],['postcode',35],['post code',35],['pin code',30],['pincode',30],['postal',20],['zip',25]],
  message: [['your message',35],['message',30],['comments',25],['comment',20],['enquiry details',35],['inquiry details',35],['project details',35],['request details',30],['tell us about your project',40],['tell us how we can help',40],['how can we help',35],['description',20],['requirements',25],['additional information',25],['additional details',25],['notes',15],['question',15],['brief',15]],
};

const autocompleteMap = { 'given-name':'firstName','family-name':'lastName','name':'fullName','email':'email','tel':'phone','organization':'organization','organization-title':'title','street-address':'streetAddress','address-line1':'streetAddress','address-level2':'city','address-level1':'state','postal-code':'zipCode' };
const ignoredTypes = new Set(['hidden','password','file','submit','button','reset','image']);
const sensitivePattern = /captcha|recaptcha|hcaptcha|turnstile|password|passcode|consent|agree|terms|privacy|newsletter|subscribe|marketing|opt[ -]?in/;
const negativeByKey = {
  firstName: /company|business|organization|organisation/, lastName: /company|business|organization|organisation/,
  fullName: /company|business|organization|organisation|cardholder/, title: /subject|salutation|prefix|mr\.?|mrs\.?|miss|ms\.?/,
  streetAddress: /email|web|ip address/, city: /citizenship/, state: /statement|estate/, zipCode: /area code|phone/,
  message: /subject|title|captcha/,
};

export function normalizeFieldText(value) {
  return String(value ?? '').replace(/([a-z0-9])([A-Z])/g,'$1 $2').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
}

function fieldSignals(field) {
  return [
    ['label', field.label, 50], ['accessibleName', field.accessibleName, 48], ['placeholder', field.placeholder, 38],
    ['name', field.name, 30], ['id', field.id, 28], ['ariaDescribedBy', field.ariaDescribedBy, 18],
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

export function getProfileValues(profile) {
  return { ...profile, fullName: profile.fullName?.trim() || [profile.firstName,profile.lastName].filter(Boolean).join(' ').trim(), message: profile.message ?? profile.approvedMessage ?? '' };
}

function ignoreReason(field) {
  const type=normalizeFieldText(field.type); const text=fieldSignals(field).map((signal)=>signal.text).join(' ');
  if(!field.fillable||field.disabled||field.readOnly||ignoredTypes.has(type)) return 'not-fillable';
  if(sensitivePattern.test(text)) return 'sensitive-or-consent';
  if(['checkbox','radio'].includes(type)) return 'choice-requires-policy';
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
    if(!winner||winner.score<AUTO_MAP_THRESHOLD||!values[winner.key]){unresolved.push({field,bestMatch:winner?.key??null,score:winner?.score??0});continue;}
    mappings.push({fieldIndex:field.index,selector:field.selector,field,profileKey:winner.key,value:values[winner.key],score:winner.score,confidence:winner.score>=100?'high':winner.score>=75?'medium':'low',matchedBy:winner.matchedBy});
  }
  return {mappings,unresolved,ignored};
}

export const FIELD_ALIASES=Object.freeze(aliases);
