import { View, type ViewProps } from "react-native";

import { type ThemeColor } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useTheme } from "@/hooks/use-theme";

export type ThemedViewProps = ViewProps & {
  lightColor?: string;
  darkColor?: string;
  type?: ThemeColor;
};

export function ThemedView({ style, lightColor, darkColor, type, ...otherProps }: ThemedViewProps) {
  const colorScheme = useColorScheme();
  const theme = useTheme();
  const backgroundColor =
    type === undefined
      ? colorScheme === "dark"
        ? (darkColor ?? theme.background)
        : (lightColor ?? theme.background)
      : theme[type];

  return <View style={[{ backgroundColor }, style]} {...otherProps} />;
}
