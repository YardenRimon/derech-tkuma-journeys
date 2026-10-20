import {receive} from './receiver-core.mjs';
export default{fetch(request,env){return receive(request,env);}};
