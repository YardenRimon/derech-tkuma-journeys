/** Invoked only after the explicit production gates. Vite receives a separate
 * config/entry and output; the review pipeline and artifact are not repurposed. */
import {createBuilder} from 'vite';
import {productionBuildInput} from './build-production.mjs';
productionBuildInput(process.env);
process.env.NODE_ENV='production';
const builder=await createBuilder({configFile:'vite.production.config.ts',mode:'production'});
await builder.buildApp();
