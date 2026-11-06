import messages from '../../content/homeMessages.json';
import { createMessagePicker } from './message-rotation';

export const chooseHomeMessage = createMessagePicker(messages);
