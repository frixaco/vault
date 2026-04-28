import { DarkTheme, DefaultTheme, ThemeProvider } from "@react-navigation/native";
import {
  SourceSerif4_400Regular,
  SourceSerif4_400Regular_Italic,
  SourceSerif4_600SemiBold,
  useFonts,
} from "@expo-google-fonts/source-serif-4";
import { Stack } from "expo-router";
import React from "react";
import { useColorScheme } from "react-native";

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const [fontsLoaded] = useFonts({
    SourceSerif4_400Regular,
    SourceSerif4_400Regular_Italic,
    SourceSerif4_600SemiBold,
  });

  if (!fontsLoaded) {
    return null;
  }

  return (
    <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
      <Stack screenOptions={{ headerShown: false }} />
    </ThemeProvider>
  );
}
