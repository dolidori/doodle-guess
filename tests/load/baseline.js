import scenario, { loadOptions } from './scenario.js';

export const options = loadOptions(Number(__ENV.ROOM_COUNT || 20));
export default scenario;
