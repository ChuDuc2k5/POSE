import { EventEmitter } from 'node:events';
// Only an invalidation signal is broadcast; contact data stays behind the API.
export const inquiryEvents = new EventEmitter();
