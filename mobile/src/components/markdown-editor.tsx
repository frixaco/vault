import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Dimensions,
  Easing,
  Keyboard,
  KeyboardAvoidingView,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type GestureResponderEvent,
  type PanResponderGestureState,
} from "react-native";
import { EnrichedMarkdownText, type MarkdownStyle } from "react-native-enriched-markdown";
import { SafeAreaView } from "react-native-safe-area-context";
import { Directory, File, Paths } from "expo-file-system";

import {
  disposeVaultSearch,
  initializeVaultSearch,
  searchVaultFiles,
  waitForVaultSearchScan,
  type SearchFile,
} from "../../modules/vault-shared";
import { Colors, Fonts, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

type AppTheme = (typeof Colors)[keyof typeof Colors];
type EditorMode = "edit" | "preview";
type NoteListItem = {
  title: string;
  folder: string;
  excerpt: string;
  updated: string;
};
type SearchState = "idle" | "initializing" | "ready" | "error";

const InitialMarkdown = `# Untitled note

Start writing. Use **bold**, _italic_, ~~strike~~, \`code\`, and [links](https://example.com).

- [x] GitHub task lists
- [ ] Tables and fenced code blocks

> A quiet editor should make the text feel close.

\`\`\`ts
const note = "plain markdown";
\`\`\`
`;

const Notes: NoteListItem[] = [
  {
    title: "Untitled note",
    folder: "Drafts",
    excerpt: "Start writing. Use bold, italic, strike, code, and links.",
    updated: "Now",
  },
  {
    title: "Back Pain Fix",
    folder: "Health",
    excerpt: "Elbow stack stretching, Mackenzie exercises, Feb update.",
    updated: "Yesterday",
  },
  {
    title: "Better portfolio website",
    folder: "Projects",
    excerpt: "Tighter case studies, fewer decorative sections, stronger proof.",
    updated: "Mon",
  },
  {
    title: "How to learn LLMs",
    folder: "Clippings",
    excerpt: "Roadmap from zero to fine-tuning and evaluation loops.",
    updated: "Apr 22",
  },
  {
    title: "Goals for 2026",
    folder: "Personal",
    excerpt: "Health, craft, focus, money, and the work that compounds.",
    updated: "Apr 18",
  },
];

const NotesPanelWidth = Dimensions.get("window").width;
const SearchPaletteMaxHeight = Dimensions.get("window").height - 140;
const SearchEase = Easing.bezier(0.2, 0, 0, 1);

function createMarkdownStyle(theme: AppTheme): MarkdownStyle {
  return {
    paragraph: {
      color: theme.text,
      fontFamily: Fonts.serif,
      fontSize: 18,
      lineHeight: 28,
      marginTop: 0,
      marginBottom: Spacing.three,
    },
    h1: {
      color: theme.text,
      fontFamily: Fonts.serifSemiBold,
      fontSize: 34,
      fontWeight: "600",
      lineHeight: 40,
      marginTop: 0,
      marginBottom: Spacing.three,
    },
    h2: {
      color: theme.text,
      fontFamily: Fonts.serifSemiBold,
      fontSize: 26,
      fontWeight: "600",
      lineHeight: 32,
      marginTop: Spacing.two,
      marginBottom: Spacing.two,
    },
    h3: {
      color: theme.text,
      fontFamily: Fonts.serifSemiBold,
      fontSize: 22,
      fontWeight: "600",
      lineHeight: 28,
      marginTop: Spacing.two,
      marginBottom: Spacing.two,
    },
    h4: {
      color: theme.text,
      fontFamily: Fonts.serifSemiBold,
      fontSize: 20,
      fontWeight: "600",
      lineHeight: 26,
      marginTop: Spacing.two,
      marginBottom: Spacing.two,
    },
    h5: {
      color: theme.text,
      fontFamily: Fonts.serifSemiBold,
      fontSize: 18,
      fontWeight: "600",
      lineHeight: 24,
      marginTop: Spacing.two,
      marginBottom: Spacing.two,
    },
    h6: {
      color: theme.textSecondary,
      fontFamily: Fonts.serifSemiBold,
      fontSize: 18,
      fontWeight: "600",
      lineHeight: 24,
      marginTop: Spacing.two,
      marginBottom: Spacing.two,
    },
    list: {
      color: theme.text,
      fontFamily: Fonts.serif,
      fontSize: 18,
      lineHeight: 28,
      markerColor: theme.textFaint,
      markerMinWidth: 24,
      gapWidth: Spacing.two,
      marginLeft: Spacing.one,
    },
    blockquote: {
      color: theme.textSecondary,
      backgroundColor: theme.backgroundElement,
      borderColor: theme.hairlineStrong,
      borderWidth: 2,
      fontFamily: Fonts.serif,
      fontSize: 18,
      gapWidth: Spacing.three,
      lineHeight: 28,
      marginBottom: Spacing.three,
    },
    code: {
      color: theme.text,
      backgroundColor: theme.active,
      borderColor: theme.hairline,
      fontFamily: Fonts.mono,
      fontSize: 16,
    },
    codeBlock: {
      color: theme.text,
      backgroundColor: theme.backgroundElement,
      borderColor: theme.hairlineStrong,
      borderRadius: Spacing.one,
      borderWidth: 1,
      fontFamily: Fonts.mono,
      fontSize: 15,
      lineHeight: 22,
      marginBottom: Spacing.three,
      padding: Spacing.three,
    },
    link: {
      color: theme.accent,
      underline: true,
    },
    strong: {
      color: theme.text,
      fontFamily: Fonts.serifSemiBold,
      fontWeight: "normal",
    },
    em: {
      color: theme.text,
      fontFamily: Fonts.serifItalic,
      fontStyle: "normal",
    },
    strikethrough: {
      color: theme.textSecondary,
    },
    table: {
      color: theme.text,
      borderColor: theme.hairlineStrong,
      borderRadius: Spacing.one,
      borderWidth: 1,
      cellPaddingHorizontal: Spacing.two,
      cellPaddingVertical: Spacing.two,
      fontFamily: Fonts.serif,
      fontSize: 15,
      headerBackgroundColor: theme.active,
      headerTextColor: theme.text,
      lineHeight: 22,
      rowEvenBackgroundColor: theme.background,
      rowOddBackgroundColor: theme.backgroundElement,
    },
    taskList: {
      borderColor: theme.textSecondary,
      checkedColor: theme.accent,
      checkedStrikethrough: true,
      checkedTextColor: theme.textSecondary,
      checkmarkColor: theme.background,
    },
    thematicBreak: {
      color: theme.hairlineStrong,
      height: 1,
      marginBottom: Spacing.three,
      marginTop: Spacing.three,
    },
  };
}

export function MarkdownEditor() {
  const theme = useTheme();
  const inputRef = useRef<TextInput>(null);
  const searchInputRef = useRef<TextInput>(null);
  const notesTranslateX = useRef(new Animated.Value(-NotesPanelWidth)).current;
  const searchOpacity = useRef(new Animated.Value(0)).current;
  const searchScale = useRef(new Animated.Value(0.97)).current;
  const searchTranslateY = useRef(new Animated.Value(-12)).current;
  const [markdown, setMarkdown] = useState(InitialMarkdown);
  const [mode, setMode] = useState<EditorMode>("preview");
  const [notesOpen, setNotesOpen] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchFile[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchState, setSearchState] = useState<SearchState>("idle");
  const [searchError, setSearchError] = useState<string | null>(null);
  const markdownStyle = useMemo(() => createMarkdownStyle(theme), [theme]);

  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (active) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);

    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    let active = true;

    async function initializeSearch() {
      setSearchState("initializing");

      try {
        const { dataPath, notesPath } = seedSearchNotes();
        await initializeVaultSearch({
          basePath: notesPath,
          dataPath,
        });
        await waitForVaultSearchScan(1000);

        if (active) {
          setSearchState("ready");
          setSearchError(null);
        }
      } catch (error) {
        if (active) {
          setSearchState("error");
          setSearchError(error instanceof Error ? error.message : String(error));
        }
      }
    }

    initializeSearch();

    return () => {
      active = false;
      disposeVaultSearch();
    };
  }, []);

  useEffect(() => {
    if (!searchOpen || searchState !== "ready") return;

    const trimmedQuery = searchQuery.trim();
    if (!trimmedQuery) {
      setSearchResults([]);
      setSearching(false);
      return;
    }

    let active = true;
    setSearching(true);

    const timeout = setTimeout(() => {
      searchVaultFiles(trimmedQuery, 24)
        .then((response) => {
          if (active) {
            setSearchResults(response.items);
            setSearchError(null);
          }
        })
        .catch((error: unknown) => {
          if (active) {
            setSearchResults([]);
            setSearchError(error instanceof Error ? error.message : String(error));
          }
        })
        .finally(() => {
          if (active) setSearching(false);
        });
    }, 80);

    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [searchOpen, searchQuery, searchState]);

  const openNotes = () => {
    Keyboard.dismiss();
    if (searchOpen) {
      closeSearch();
    }
    setNotesOpen(true);
    Animated.timing(notesTranslateX, {
      duration: 180,
      toValue: 0,
      useNativeDriver: true,
    }).start();
  };

  const closeNotes = () => {
    Animated.timing(notesTranslateX, {
      duration: 150,
      toValue: -NotesPanelWidth,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setNotesOpen(false);
      }
    });
  };

  const openSearch = () => {
    if (notesOpen) {
      closeNotes();
    }

    Keyboard.dismiss();
    setSearchOpen(true);

    if (reduceMotion) {
      searchOpacity.setValue(1);
      searchScale.setValue(1);
      searchTranslateY.setValue(0);
      requestAnimationFrame(() => searchInputRef.current?.focus());
      return;
    }

    searchOpacity.setValue(0);
    searchScale.setValue(0.97);
    searchTranslateY.setValue(-12);
    Animated.parallel([
      Animated.timing(searchOpacity, {
        duration: 160,
        easing: SearchEase,
        toValue: 1,
        useNativeDriver: true,
      }),
      Animated.timing(searchScale, {
        duration: 180,
        easing: SearchEase,
        toValue: 1,
        useNativeDriver: true,
      }),
      Animated.timing(searchTranslateY, {
        duration: 180,
        easing: SearchEase,
        toValue: 0,
        useNativeDriver: true,
      }),
    ]).start(() => {
      searchInputRef.current?.focus();
    });
  };

  const closeSearch = () => {
    Keyboard.dismiss();

    if (reduceMotion) {
      setSearchOpen(false);
      return;
    }

    Animated.parallel([
      Animated.timing(searchOpacity, {
        duration: 120,
        easing: SearchEase,
        toValue: 0,
        useNativeDriver: true,
      }),
      Animated.timing(searchScale, {
        duration: 120,
        easing: SearchEase,
        toValue: 0.985,
        useNativeDriver: true,
      }),
      Animated.timing(searchTranslateY, {
        duration: 120,
        easing: SearchEase,
        toValue: -8,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) {
        setSearchOpen(false);
      }
    });
  };

  const openSearchResult = (result: SearchFile) => {
    const title = getNoteTitleFromPath(result.path);
    const note = Notes.find((item) => item.title === title);

    setMarkdown(note ? createSeedMarkdown(note) : `# ${title}\n\n${result.path}`);
    setMode("preview");
    closeSearch();
  };

  const swipeResponder = useMemo(() => {
    function shouldHandlePan(
      { nativeEvent }: GestureResponderEvent,
      gesture: PanResponderGestureState,
    ) {
      const horizontalSwipe =
        Math.abs(gesture.dx) > 16 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.4;
      const verticalSwipe =
        Math.abs(gesture.dy) > 18 && Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.4;
      const openingFromEdge = !notesOpen && nativeEvent.pageX < 32 && gesture.dx > 0;
      const closingPanel = notesOpen && gesture.dx < 0;
      const startedNearTop = gesture.y0 < 128;
      const openingSearch = !searchOpen && !notesOpen && startedNearTop && gesture.dy > 0;
      const closingSearch = searchOpen && gesture.y0 < 260 && gesture.dy < 0;

      return (
        (horizontalSwipe && (openingFromEdge || closingPanel)) ||
        (verticalSwipe && (openingSearch || closingSearch))
      );
    }

    return PanResponder.create({
      onMoveShouldSetPanResponder: shouldHandlePan,
      onMoveShouldSetPanResponderCapture: shouldHandlePan,
      onPanResponderRelease: (_event, gesture) => {
        if (!notesOpen && gesture.dx > 56) {
          Keyboard.dismiss();
          openNotes();
        }
        if (notesOpen && gesture.dx < -48) {
          closeNotes();
        }
        if (!searchOpen && !notesOpen && gesture.dy > 56) {
          openSearch();
        }
        if (searchOpen && gesture.dy < -44) {
          closeSearch();
        }
      },
    });
  }, [notesOpen, searchOpen]);

  const enterEditMode = () => {
    setMode("edit");
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const enterPreviewMode = () => {
    Keyboard.dismiss();
    setMode("preview");
  };

  const isEditing = mode === "edit";

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: theme.background }]}
      {...swipeResponder.panHandlers}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.keyboardView}
      >
        {isEditing ? (
          <TextInput
            ref={inputRef}
            autoCapitalize="sentences"
            cursorColor={theme.accent}
            multiline
            onChangeText={setMarkdown}
            placeholder="Start writing..."
            placeholderTextColor={theme.textFaint}
            scrollEnabled
            selectionColor={theme.selection}
            style={[styles.sourceInput, { color: theme.text }]}
            textAlignVertical="top"
            value={markdown}
          />
        ) : (
          <ScrollView
            contentContainerStyle={styles.previewContent}
            keyboardShouldPersistTaps="handled"
            style={styles.preview}
          >
            <EnrichedMarkdownText
              flavor="github"
              markdown={markdown.trim().length > 0 ? markdown : "Nothing to preview yet."}
              markdownStyle={markdownStyle}
              selectable
            />
          </ScrollView>
        )}

        <Pressable
          accessibilityLabel={isEditing ? "Preview note" : "Edit note"}
          accessibilityRole="button"
          onPress={isEditing ? enterPreviewMode : enterEditMode}
          style={[
            styles.modeButton,
            {
              backgroundColor: theme.backgroundElement,
              borderColor: theme.hairlineStrong,
              shadowColor: theme.text,
            },
          ]}
        >
          {isEditing ? (
            <PreviewIcon color={theme.textSecondary} accentColor={theme.accent} />
          ) : (
            <EditIcon color={theme.textSecondary} accentColor={theme.accent} />
          )}
        </Pressable>
      </KeyboardAvoidingView>

      {notesOpen && (
        <View style={styles.notesOverlay}>
          <Pressable
            accessibilityLabel="Close notes"
            onPress={closeNotes}
            style={styles.notesScrim}
          />
          <Animated.View
            style={[
              styles.notesAnimatedPanel,
              {
                transform: [{ translateX: notesTranslateX }],
              },
            ]}
          >
            <NotesPanel notes={Notes} onClose={closeNotes} theme={theme} />
          </Animated.View>
        </View>
      )}

      {searchOpen && (
        <SearchOverlay
          error={searchError}
          inputRef={searchInputRef}
          nativeResults={searchResults}
          notes={Notes}
          onChangeQuery={setSearchQuery}
          onClose={closeSearch}
          onOpenResult={openSearchResult}
          opacity={searchOpacity}
          query={searchQuery}
          scale={searchScale}
          searchState={searchState}
          searching={searching}
          theme={theme}
          translateY={searchTranslateY}
        />
      )}
    </SafeAreaView>
  );
}

function SearchOverlay({
  error,
  inputRef,
  nativeResults,
  notes,
  onChangeQuery,
  onClose,
  onOpenResult,
  opacity,
  query,
  scale,
  searchState,
  searching,
  theme,
  translateY,
}: {
  error: string | null;
  inputRef: React.RefObject<TextInput | null>;
  nativeResults: SearchFile[];
  notes: NoteListItem[];
  onChangeQuery: (query: string) => void;
  onClose: () => void;
  onOpenResult: (result: SearchFile) => void;
  opacity: Animated.Value;
  query: string;
  scale: Animated.Value;
  searchState: SearchState;
  searching: boolean;
  theme: AppTheme;
  translateY: Animated.Value;
}) {
  const showNativeResults = query.trim().length > 0;
  const recentResults = notes.map(noteToSearchFile);
  const results = showNativeResults ? nativeResults : recentResults;
  const label = showNativeResults ? "Notes" : "Recent";
  const emptyText =
    searchState === "initializing"
      ? "Indexing notes"
      : error
        ? error
        : searching
          ? "Searching notes"
          : showNativeResults
            ? "No notes found"
            : "No notes";

  return (
    <Animated.View style={[styles.searchOverlay, { opacity }]}>
      <Pressable accessibilityLabel="Close search" onPress={onClose} style={styles.searchScrim} />
      <Animated.View
        style={[
          styles.searchPalette,
          {
            backgroundColor: theme.backgroundElement,
            borderColor: theme.hairlineStrong,
            shadowColor: theme.text,
            transform: [{ translateY }, { scale }],
          },
        ]}
      >
        <View style={[styles.searchInputRow, { borderColor: theme.hairline }]}>
          <SearchIcon color={theme.textFaint} />
          <TextInput
            ref={inputRef}
            autoCapitalize="none"
            autoCorrect={false}
            cursorColor={theme.accent}
            onChangeText={onChangeQuery}
            placeholder="Find note..."
            placeholderTextColor={theme.textFaint}
            selectionColor={theme.selection}
            style={[styles.searchInput, { color: theme.text }]}
            value={query}
          />
        </View>

        <View style={styles.searchResultFrame}>
          <Text style={[styles.searchSectionLabel, { color: theme.textFaint }]}>{label}</Text>
          {results.length > 0 && !error ? (
            <ScrollView
              contentContainerStyle={styles.searchResultList}
              keyboardShouldPersistTaps="handled"
              style={styles.searchResultScroll}
            >
              {results.map((result, index) => (
                <Pressable
                  key={result.path}
                  onPress={() => onOpenResult(result)}
                  style={({ pressed }) => [
                    styles.searchResultRow,
                    {
                      backgroundColor: index === 0 ? theme.active : "transparent",
                      transform: [{ scale: pressed ? 0.985 : 1 }],
                    },
                  ]}
                >
                  <Text numberOfLines={1} style={[styles.searchResultTitle, { color: theme.text }]}>
                    {getNoteTitleFromPath(result.path)}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={[styles.searchResultMeta, { color: theme.textFaint }]}
                  >
                    {getSearchDirectory(result.path)}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : (
            <Text
              style={[styles.searchEmptyText, { color: error ? theme.accent : theme.textFaint }]}
            >
              {emptyText}
            </Text>
          )}
        </View>
      </Animated.View>
    </Animated.View>
  );
}

function NotesPanel({
  notes,
  onClose,
  theme,
}: {
  notes: NoteListItem[];
  onClose: () => void;
  theme: AppTheme;
}) {
  return (
    <View
      style={[
        styles.notesPanel,
        {
          backgroundColor: theme.background,
          borderRightColor: theme.hairline,
          shadowColor: theme.text,
        },
      ]}
    >
      <View style={[styles.notesHeader, { borderBottomColor: theme.hairline }]}>
        <Text style={[styles.notesTitle, { color: theme.textSecondary }]}>Notes</Text>
        <Pressable
          accessibilityLabel="Close notes"
          onPress={onClose}
          style={styles.notesCloseButton}
        >
          <CloseIcon color={theme.textSecondary} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.notesList}>
        {notes.map((note, index) => (
          <Pressable
            key={note.title}
            onPress={onClose}
            style={[
              styles.noteRow,
              {
                backgroundColor: index === 0 ? theme.active : theme.background,
                borderBottomColor: theme.hairline,
              },
            ]}
          >
            <View style={styles.noteRowTop}>
              <Text numberOfLines={1} style={[styles.noteTitle, { color: theme.text }]}>
                {note.title}
              </Text>
              <Text style={[styles.noteDate, { color: theme.textFaint }]}>{note.updated}</Text>
            </View>
            <Text style={[styles.noteFolder, { color: theme.accent }]}>{note.folder}</Text>
            <Text numberOfLines={2} style={[styles.noteExcerpt, { color: theme.textSecondary }]}>
              {note.excerpt}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

function seedSearchNotes() {
  const notesDirectory = new Directory(Paths.document, "VaultNotes");
  const dataDirectory = new Directory(Paths.document, ".VaultSearch");

  notesDirectory.create({ idempotent: true, intermediates: true });
  dataDirectory.create({ idempotent: true, intermediates: true });

  for (const note of Notes) {
    const folder = new Directory(notesDirectory, note.folder);
    folder.create({ idempotent: true, intermediates: true });

    const file = new File(folder, `${sanitizeNoteFilename(note.title)}.md`);
    file.create({ intermediates: true, overwrite: true });
    file.write(createSeedMarkdown(note));
  }

  return {
    dataPath: toNativePath(dataDirectory.uri),
    notesPath: toNativePath(notesDirectory.uri),
  };
}

function createSeedMarkdown(note: NoteListItem) {
  return `# ${note.title}

${note.excerpt}

Folder: ${note.folder}
Updated: ${note.updated}
`;
}

function toNativePath(uri: string) {
  return decodeURI(uri.replace(/^file:\/\//, ""));
}

function sanitizeNoteFilename(value: string) {
  return value.replace(/[/:]/g, " ").trim();
}

function noteToSearchFile(note: NoteListItem): SearchFile {
  return {
    directory: note.folder,
    name: `${note.title}.md`,
    path: `${note.folder}/${note.title}.md`,
    score: 0,
  };
}

function getNoteTitleFromPath(path: string) {
  const filename = path.split("/").at(-1) ?? path;
  return filename.endsWith(".md") ? filename.slice(0, -3) : filename;
}

function getSearchDirectory(path: string) {
  const parts = path.split("/");
  parts.pop();
  return parts.join("/") || "Vault";
}

function EditIcon({ color, accentColor }: { color: string; accentColor: string }) {
  return (
    <View style={[styles.editIconFrame, { borderColor: color }]}>
      <View style={[styles.editIconLine, { backgroundColor: color }]} />
      <View style={[styles.editIconLineShort, { backgroundColor: color }]} />
      <View style={[styles.editIconCaret, { backgroundColor: accentColor }]} />
    </View>
  );
}

function PreviewIcon({ color, accentColor }: { color: string; accentColor: string }) {
  return (
    <View style={styles.previewIconFrame}>
      <View style={[styles.previewIconLine, { backgroundColor: color }]} />
      <View style={[styles.previewIconLine, { backgroundColor: color }]} />
      <View style={[styles.previewIconRule, { backgroundColor: accentColor }]} />
    </View>
  );
}

function CloseIcon({ color }: { color: string }) {
  return (
    <View style={styles.closeIcon}>
      <View
        style={[styles.closeIconLine, { backgroundColor: color, transform: [{ rotate: "45deg" }] }]}
      />
      <View
        style={[
          styles.closeIconLine,
          { backgroundColor: color, transform: [{ rotate: "-45deg" }] },
        ]}
      />
    </View>
  );
}

function SearchIcon({ color }: { color: string }) {
  return (
    <View style={styles.searchIcon}>
      <View style={[styles.searchIconCircle, { borderColor: color }]} />
      <View style={[styles.searchIconHandle, { backgroundColor: color }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  keyboardView: {
    flex: 1,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
  },
  notesOverlay: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: "row",
  },
  notesScrim: {
    ...StyleSheet.absoluteFillObject,
  },
  notesAnimatedPanel: {
    ...StyleSheet.absoluteFillObject,
  },
  notesPanel: {
    borderRightWidth: 0,
    height: "100%",
    shadowOffset: {
      width: 8,
      height: 0,
    },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    width: "100%",
    zIndex: 1,
  },
  searchOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    paddingHorizontal: Spacing.three,
    paddingTop: 72,
    zIndex: 2,
  },
  searchScrim: {
    ...StyleSheet.absoluteFillObject,
  },
  searchPalette: {
    borderRadius: 3,
    borderWidth: 1,
    maxHeight: SearchPaletteMaxHeight,
    padding: Spacing.two,
    shadowOffset: {
      width: 0,
      height: 18,
    },
    shadowOpacity: 0.14,
    shadowRadius: 42,
    width: "100%",
  },
  searchInputRow: {
    alignItems: "center",
    borderWidth: 1,
    flexDirection: "row",
    gap: Spacing.two,
    height: 42,
    paddingHorizontal: Spacing.three,
  },
  searchInput: {
    flex: 1,
    fontFamily: Fonts.mono,
    fontSize: 13,
    lineHeight: 18,
    padding: 0,
  },
  searchResultFrame: {
    flexShrink: 1,
    paddingTop: Spacing.two,
  },
  searchSectionLabel: {
    fontFamily: Fonts.mono,
    fontSize: 10,
    lineHeight: 14,
    paddingBottom: Spacing.one,
    paddingHorizontal: Spacing.two,
    textTransform: "uppercase",
  },
  searchResultScroll: {
    maxHeight: SearchPaletteMaxHeight - 72,
  },
  searchResultList: {
    gap: Spacing.half,
  },
  searchResultRow: {
    borderRadius: 2,
    paddingHorizontal: Spacing.three,
    paddingVertical: 9,
  },
  searchResultTitle: {
    fontFamily: Fonts.mono,
    fontSize: 12,
    lineHeight: 16,
  },
  searchResultMeta: {
    fontFamily: Fonts.mono,
    fontSize: 10,
    lineHeight: 14,
    marginTop: Spacing.half,
  },
  searchEmptyText: {
    fontFamily: Fonts.mono,
    fontSize: 12,
    lineHeight: 18,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.four,
    textAlign: "center",
  },
  notesHeader: {
    alignItems: "center",
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  notesTitle: {
    fontFamily: Fonts.mono,
    fontSize: 12,
    letterSpacing: 0,
    lineHeight: 16,
  },
  notesCloseButton: {
    alignItems: "center",
    height: 28,
    justifyContent: "center",
    width: 28,
  },
  notesList: {
    paddingBottom: Spacing.four,
  },
  noteRow: {
    borderBottomWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  noteRowTop: {
    alignItems: "baseline",
    flexDirection: "row",
    gap: Spacing.two,
    justifyContent: "space-between",
  },
  noteTitle: {
    flex: 1,
    fontFamily: Fonts.serifSemiBold,
    fontSize: 17,
    fontWeight: "600",
    lineHeight: 22,
  },
  noteDate: {
    fontFamily: Fonts.mono,
    fontSize: 11,
    lineHeight: 16,
  },
  noteFolder: {
    fontFamily: Fonts.mono,
    fontSize: 11,
    lineHeight: 18,
    marginTop: Spacing.one,
  },
  noteExcerpt: {
    fontFamily: Fonts.serif,
    fontSize: 14,
    lineHeight: 19,
    marginTop: Spacing.one,
  },
  sourceInput: {
    flex: 1,
    fontFamily: Fonts.serif,
    fontSize: 18,
    lineHeight: 31,
    minHeight: 420,
    padding: 0,
    paddingBottom: 96,
  },
  preview: {
    flex: 1,
  },
  previewContent: {
    paddingBottom: 96,
  },
  modeButton: {
    alignItems: "center",
    borderRadius: 3,
    borderWidth: 1,
    bottom: Spacing.four,
    height: 44,
    justifyContent: "center",
    position: "absolute",
    right: Spacing.four,
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    width: 44,
  },
  editIconFrame: {
    borderWidth: 1.5,
    height: 22,
    justifyContent: "center",
    paddingHorizontal: 4,
    width: 20,
  },
  editIconLine: {
    height: 1.5,
    marginBottom: 5,
    width: 9,
  },
  editIconLineShort: {
    height: 1.5,
    width: 6,
  },
  editIconCaret: {
    height: 14,
    position: "absolute",
    right: 4,
    top: 4,
    transform: [{ rotate: "28deg" }],
    width: 2,
  },
  previewIconFrame: {
    gap: 5,
    width: 22,
  },
  previewIconLine: {
    height: 2,
    width: 22,
  },
  previewIconRule: {
    height: 2,
    width: 13,
  },
  closeIcon: {
    height: 14,
    justifyContent: "center",
    width: 14,
  },
  closeIconLine: {
    height: 1,
    position: "absolute",
    width: 14,
  },
  searchIcon: {
    height: 15,
    width: 15,
  },
  searchIconCircle: {
    borderRadius: 5,
    borderWidth: 1.5,
    height: 10,
    left: 0,
    position: "absolute",
    top: 0,
    width: 10,
  },
  searchIconHandle: {
    height: 6,
    left: 10,
    position: "absolute",
    top: 9,
    transform: [{ rotate: "-45deg" }],
    width: 1.5,
  },
});
