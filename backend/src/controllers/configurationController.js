import { env } from '../config/env.js'; import { validateConfig } from '../validators/configValidator.js';
export function getConfiguration(_req,res){res.json({batchSize:env.batchSize,dryRun:env.dryRun,browserMode:env.headless?'headless':'visible',protected:Boolean(env.apiAuthToken)});} export function validateConfiguration(req,res){res.json({valid:true,configuration:validateConfig(req.body)});}
