import { DEFAULT_AUTOMATION_CONFIG } from './automationConfig.js';
import { DEFAULT_CONTACT_PROFILE } from './contactProfile.js';
const CONFIG_KEY='contactAutomation.config';const PROFILE_KEY='contactAutomation.profile';
function read(key,fallback){try{return {...fallback,...JSON.parse(localStorage.getItem(key)||'{}')};}catch{return {...fallback};}}
export const loadAutomationConfig=()=>read(CONFIG_KEY,DEFAULT_AUTOMATION_CONFIG);
export const loadContactProfile=()=>read(PROFILE_KEY,DEFAULT_CONTACT_PROFILE);
export const saveAutomationConfig=(value)=>localStorage.setItem(CONFIG_KEY,JSON.stringify(value));
export const saveContactProfile=(value)=>localStorage.setItem(PROFILE_KEY,JSON.stringify(value));
