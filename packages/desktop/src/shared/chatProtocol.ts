/**
 * The `message` of the coach-chat result main returns when the user pressed
 * "stop" (main/coachChat.ts). The renderer (CoachChatCard) compares against it
 * to tell a cancel from a failure, so both sides import this one constant.
 * A protocol sentinel, never rendered: its value stays as it was.
 */
export const CHAT_STOPPED_MESSAGE = "已停止";
