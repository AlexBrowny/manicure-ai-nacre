// Единый конверт ответов API: { success: true, data } / { success: false, error, code }.
export const ok = (data = null) => ({ success: true, data });

export const fail = (error, code) => ({ success: false, error, code });
