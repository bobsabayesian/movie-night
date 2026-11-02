import config from '../../shared/config.json';

export default config;

export const enabledStyles = (disabled: string[]) => config.styles.filter((s) => !disabled.includes(s));
export const enabledGenres = (disabled: string[]) => config.genres.filter((g) => !disabled.includes(g));
