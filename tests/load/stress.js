import scenario, { loadOptions } from './scenario.js';

export const options = loadOptions(Number(__ENV.ROOM_COUNT || 50));
export default scenario;
