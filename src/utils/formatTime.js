export const formatTime = (mins) => Math.floor((mins || 0) / 60) + 'h ' + ((mins || 0) % 60) + 'm';
