export const chatStorageKey='terava-chat-v1';
export function clearChatStorage(){
  try{window.sessionStorage.removeItem(chatStorageKey);}catch{}
  window.dispatchEvent(new Event('terava-chat-clear'));
}
