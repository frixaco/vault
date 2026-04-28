import { Platform } from "react-native";

export const Colors = {
  light: {
    text: "#383530",
    background: "#FBFAF7",
    backgroundElement: "#F5F2EC",
    backgroundSelected: "#ECE7DD",
    textSecondary: "#7D766C",
    textFaint: "#B0AAA1",
    hairline: "#E8E1D8",
    hairlineStrong: "#D8D0C4",
    accent: "#A34F3F",
    selection: "#EBD8D2",
    active: "#EEE9E0",
  },
  dark: {
    text: "#E3DED6",
    background: "#242426",
    backgroundElement: "#2B2C2E",
    backgroundSelected: "#363638",
    textSecondary: "#99938B",
    textFaint: "#66625D",
    hairline: "#343537",
    hairlineStrong: "#49494A",
    accent: "#D98A79",
    selection: "#52352F",
    active: "#343536",
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: "system-ui",
    serif: "SourceSerif4_400Regular",
    serifItalic: "SourceSerif4_400Regular_Italic",
    serifSemiBold: "SourceSerif4_600SemiBold",
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: "ui-rounded",
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: "ui-monospace",
  },
  default: {
    sans: "normal",
    serif: "SourceSerif4_400Regular",
    serifItalic: "SourceSerif4_400Regular_Italic",
    serifSemiBold: "SourceSerif4_600SemiBold",
    rounded: "normal",
    mono: "monospace",
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;
