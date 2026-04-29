import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlashList, type ListRenderItem } from "@shopify/flash-list";
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
  type PanResponderGestureState,
} from "react-native";
import ReanimatedDrawerLayout, {
  DrawerKeyboardDismissMode,
  DrawerPosition,
  DrawerType,
  type DrawerLayoutMethods,
} from "react-native-gesture-handler/ReanimatedDrawerLayout";
import { EnrichedMarkdownText, type MarkdownStyle } from "react-native-enriched-markdown";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  disposeVaultSearch,
  initializeVaultSearch,
  searchVaultNotes,
  waitForVaultSearchScan,
  type ContentSearchResult,
  type NoteSearchResponse,
  type NoteSearchResult,
  type TitleSearchResult,
} from "../../modules/vault-shared";
import { Colors, Fonts, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import {
  createMobileNote,
  initializeMobileVault,
  listMobileNotes,
  readMobileNote,
  resolveMobileMediaUri,
  writeMobileNote,
  type MobileNoteMeta,
} from "@/services/note-file-service";

type AppTheme = (typeof Colors)[keyof typeof Colors];
type EditorMode = "edit" | "preview";
type NoteTreeRow =
  | {
      depth: number;
      id: string;
      kind: "folder";
      name: string;
      path: string;
    }
  | {
      depth: number;
      id: string;
      kind: "note";
      name: string;
      note: MobileNoteMeta;
      path: string;
    };
type NoteTreeIndex = {
  foldersByParent: Map<string, string[]>;
  notesByDirectory: Map<string, MobileNoteMeta[]>;
};
type SearchState = "idle" | "initializing" | "ready" | "error";

const EmptySearchResponse: NoteSearchResponse = {
  best: [],
  content: [],
  query: "",
  scope: "all",
  title: [],
};

const NotesPanelWidth = Math.min(Dimensions.get("window").width * 0.88, 380);
const NotesOpenEdgeWidth = 48;
const SearchPaletteMaxHeight = Dimensions.get("window").height - 140;
const SearchEase = Easing.bezier(0.2, 0, 0, 1);
const ImageMediaExtensions = new Set(["avif", "gif", "jpeg", "jpg", "png", "svg", "webp"]);
const MaxCachedNoteContents = 12;

function isBlankMarkdown(content: string) {
  return (
    content
      .split(/\r?\n/)
      .filter((line) => !/^#{1,6}\s*$/.test(line.trim()))
      .join("\n")
      .trim().length === 0
  );
}

function createPreviewMarkdown(notePath: string | null, content: string) {
  if (!notePath) return content;

  return content
    .replace(/!\[\[([^\]\n]+)\]\]/g, (raw, target: string) => {
      const { label, mediaPath, rawTarget } = parseObsidianMediaTarget(target);
      if (!isImageMediaPath(mediaPath)) return raw;

      const uri = resolveMobileMediaUri(notePath, mediaPath);
      if (!uri) return raw;

      return `![${label || mediaPath}](${formatMarkdownLinkTarget(uri)} "${rawTarget}")`;
    })
    .replace(/!\[([^\]\n]*)\]\(([^\n)]+)\)/g, (raw, alt: string, rawTarget: string) => {
      const { suffix, target } = parseMarkdownImageTarget(rawTarget);
      if (!shouldResolveVaultMediaPath(target) || !isImageMediaPath(target)) return raw;

      const uri = resolveMobileMediaUri(notePath, target);
      if (!uri) return raw;

      return `![${alt}](${formatMarkdownLinkTarget(uri)}${suffix})`;
    });
}

function parseObsidianMediaTarget(target: string) {
  const [mediaPath = "", ...labelParts] = target.split("|");

  return {
    label: labelParts.join("|").trim(),
    mediaPath: mediaPath.trim(),
    rawTarget: target.trim(),
  };
}

function parseMarkdownImageTarget(rawTarget: string) {
  const trimmedTarget = rawTarget.trim();

  if (trimmedTarget.startsWith("<")) {
    const endIndex = trimmedTarget.indexOf(">");
    if (endIndex >= 0) {
      return {
        suffix: trimmedTarget.slice(endIndex + 1),
        target: trimmedTarget.slice(1, endIndex),
      };
    }
  }

  const match = trimmedTarget.match(/^(.+?)(\s+(?:"[^"]*"|'[^']*'))\s*$/);
  if (match) {
    return {
      suffix: match[2] ?? "",
      target: match[1]?.trim() ?? "",
    };
  }

  return {
    suffix: "",
    target: trimmedTarget,
  };
}

function formatMarkdownLinkTarget(target: string) {
  return /[\s()<>]/.test(target) ? `<${target}>` : target;
}

function shouldResolveVaultMediaPath(mediaPath: string) {
  return mediaPath.length > 0 && !/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(mediaPath);
}

function isImageMediaPath(mediaPath: string) {
  const extension = mediaPath.split(/[?#]/, 1)[0]?.split(".").at(-1)?.toLowerCase() ?? "";
  return ImageMediaExtensions.has(extension);
}

function getCachedNoteContent(cache: Map<string, string>, notePath: string) {
  const content = cache.get(notePath);
  if (content === undefined) return null;

  cache.delete(notePath);
  cache.set(notePath, content);
  return content;
}

function rememberCachedNoteContent(cache: Map<string, string>, notePath: string, content: string) {
  cache.delete(notePath);
  cache.set(notePath, content);

  while (cache.size > MaxCachedNoteContents) {
    const oldestNotePath = cache.keys().next().value;
    if (!oldestNotePath) return;
    cache.delete(oldestNotePath);
  }
}

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
  const drawerRef = useRef<DrawerLayoutMethods>(null);
  const inputRef = useRef<TextInput>(null);
  const previewScrollRef = useRef<ScrollView>(null);
  const searchInputRef = useRef<TextInput>(null);
  const searchOpacity = useRef(new Animated.Value(0)).current;
  const searchScale = useRef(new Animated.Value(0.97)).current;
  const searchTranslateY = useRef(new Animated.Value(-12)).current;
  const activeNotePathRef = useRef<string | null>(null);
  const noteContentCacheRef = useRef(new Map<string, string>());
  const savedMarkdownRef = useRef("");
  const saveGenerationRef = useRef(0);
  const [activeNotePath, setActiveNotePath] = useState<string | null>(null);
  const [markdown, setMarkdown] = useState("");
  const [mode, setMode] = useState<EditorMode>("preview");
  const [notes, setNotes] = useState<MobileNoteMeta[]>([]);
  const [notesOpen, setNotesOpen] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<NoteSearchResponse>(EmptySearchResponse);
  const [searching, setSearching] = useState(false);
  const [searchState, setSearchState] = useState<SearchState>("idle");
  const [searchError, setSearchError] = useState<string | null>(null);
  const markdownStyle = useMemo(() => createMarkdownStyle(theme), [theme]);
  const previewMarkdown = useMemo(
    () => createPreviewMarkdown(activeNotePath, markdown),
    [activeNotePath, markdown],
  );

  useEffect(() => {
    activeNotePathRef.current = activeNotePath;
  }, [activeNotePath]);

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

    async function initializeVaultAndSearch() {
      setSearchState("initializing");

      try {
        const vault = await initializeMobileVault();
        const firstNote = vault.notes[0] ?? null;

        if (active) {
          setNotes(vault.notes);
          activeNotePathRef.current = firstNote?.path ?? null;
          setActiveNotePath(firstNote?.path ?? null);
          setMarkdown(firstNote ? `# ${firstNote.title}\n` : "");
          savedMarkdownRef.current = firstNote ? `# ${firstNote.title}\n` : "";
        }

        if (firstNote) {
          const initialMarkdown = await readMobileNote(firstNote.path);
          rememberCachedNoteContent(noteContentCacheRef.current, firstNote.path, initialMarkdown);

          if (active && activeNotePathRef.current === firstNote.path) {
            setMarkdown(initialMarkdown);
            savedMarkdownRef.current = initialMarkdown;
          }
        }

        await initializeVaultSearch({
          basePath: vault.notesPath,
          dataPath: vault.dataPath,
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

    initializeVaultAndSearch();

    return () => {
      active = false;
      disposeVaultSearch();
    };
  }, []);

  useEffect(() => {
    if (markdown === savedMarkdownRef.current) return;
    if (!activeNotePath && isBlankMarkdown(markdown)) return;

    const generation = saveGenerationRef.current + 1;
    saveGenerationRef.current = generation;

    const timeout = setTimeout(() => {
      const saveNote = activeNotePath
        ? writeMobileNote(activeNotePath, markdown)
        : createMobileNote(markdown);

      saveNote
        .then(async (result) => {
          if (saveGenerationRef.current !== generation) return;

          savedMarkdownRef.current = result.content;
          if (activeNotePath && activeNotePath !== result.path) {
            noteContentCacheRef.current.delete(activeNotePath);
          }
          rememberCachedNoteContent(noteContentCacheRef.current, result.path, result.content);
          if (activeNotePathRef.current === activeNotePath) {
            activeNotePathRef.current = result.path;
            setActiveNotePath(result.path);
            if (result.content !== markdown) setMarkdown(result.content);
          }

          const nextNotes = await listMobileNotes();
          setNotes(nextNotes);
          await waitForVaultSearchScan(250);
        })
        .catch((error: unknown) => {
          setSearchError(error instanceof Error ? error.message : String(error));
        });
    }, 400);

    return () => {
      clearTimeout(timeout);
    };
  }, [activeNotePath, markdown]);

  useEffect(() => {
    requestAnimationFrame(() => {
      previewScrollRef.current?.scrollTo({ animated: false, y: 0 });
    });
  }, [activeNotePath]);

  useEffect(() => {
    if (!searchOpen || searchState !== "ready") return;

    const trimmedQuery = searchQuery.trim();
    if (!trimmedQuery) {
      setSearchResults(EmptySearchResponse);
      setSearching(false);
      return;
    }

    let active = true;
    setSearching(true);

    const timeout = setTimeout(() => {
      searchVaultNotes(trimmedQuery, "all")
        .then((response) => {
          if (active) {
            setSearchResults(response);
            setSearchError(null);
          }
        })
        .catch((error: unknown) => {
          if (active) {
            setSearchResults(EmptySearchResponse);
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

  const closeNotes = () => {
    drawerRef.current?.closeDrawer();
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

  const openNote = async (notePath: string) => {
    if (notePath === activeNotePath) return;

    const previousNotePath = activeNotePath;
    const previousMarkdown = markdown;
    const previousSavedMarkdown = savedMarkdownRef.current;
    const cachedMarkdown = getCachedNoteContent(noteContentCacheRef.current, notePath);
    const optimisticMarkdown = cachedMarkdown ?? `# ${getPathBasename(notePath)}\n`;

    saveGenerationRef.current += 1;
    activeNotePathRef.current = notePath;
    setActiveNotePath(notePath);
    setMarkdown(optimisticMarkdown);
    savedMarkdownRef.current = optimisticMarkdown;
    setMode("preview");
    setSearchError(null);

    try {
      const nextContentPromise = cachedMarkdown ? null : readMobileNote(notePath);

      if (previousNotePath && previousMarkdown !== previousSavedMarkdown) {
        const savedNote = await writeMobileNote(previousNotePath, previousMarkdown);
        if (previousNotePath !== savedNote.path) {
          noteContentCacheRef.current.delete(previousNotePath);
        }
        rememberCachedNoteContent(noteContentCacheRef.current, savedNote.path, savedNote.content);
        if (activeNotePathRef.current === savedNote.path) {
          savedMarkdownRef.current = savedNote.content;
        }

        void listMobileNotes()
          .then((nextNotes) => {
            setNotes(nextNotes);
          })
          .catch((error: unknown) => {
            setSearchError(error instanceof Error ? error.message : String(error));
          });
      }

      if (nextContentPromise) {
        const content = await nextContentPromise;
        rememberCachedNoteContent(noteContentCacheRef.current, notePath, content);
        if (activeNotePathRef.current === notePath) {
          setMarkdown(content);
          savedMarkdownRef.current = content;
        }
      }
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : String(error));
    }
  };

  const openSearchResult = (result: NoteSearchResult) => {
    void openNote(result.notePath);
    closeSearch();
  };

  const swipeResponder = useMemo(() => {
    function shouldHandlePan(_event: unknown, gesture: PanResponderGestureState) {
      const verticalSwipe =
        Math.abs(gesture.dy) > 18 && Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.4;
      const startedNearTop = gesture.y0 < 128;
      const openingSearch = !searchOpen && !notesOpen && startedNearTop && gesture.dy > 0;
      const closingSearch = searchOpen && gesture.y0 < 260 && gesture.dy < 0;

      return verticalSwipe && (openingSearch || closingSearch);
    }

    return PanResponder.create({
      onMoveShouldSetPanResponder: shouldHandlePan,
      onMoveShouldSetPanResponderCapture: shouldHandlePan,
      onPanResponderRelease: (_event, gesture) => {
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

  const handleMarkdownChange = (content: string) => {
    setMarkdown(content);
    if (activeNotePathRef.current) {
      rememberCachedNoteContent(noteContentCacheRef.current, activeNotePathRef.current, content);
    }
  };

  const isEditing = mode === "edit";

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
      <ReanimatedDrawerLayout
        ref={drawerRef}
        drawerBackgroundColor={theme.background}
        drawerPosition={DrawerPosition.LEFT}
        drawerType={DrawerType.FRONT}
        drawerWidth={NotesPanelWidth}
        edgeWidth={NotesOpenEdgeWidth}
        keyboardDismissMode={DrawerKeyboardDismissMode.ON_DRAG}
        minSwipeDistance={8}
        onDrawerClose={() => setNotesOpen(false)}
        onDrawerOpen={() => setNotesOpen(true)}
        overlayColor="rgba(0, 0, 0, 0.18)"
        contentContainerStyle={styles.drawerLayout}
        renderNavigationView={() => (
          <NotesPanel
            activeNotePath={activeNotePath}
            notes={notes}
            onClose={closeNotes}
            onOpenNote={(notePath) => {
              void openNote(notePath);
              closeNotes();
            }}
            theme={theme}
          />
        )}
      >
        <View style={styles.contentHost} {...swipeResponder.panHandlers}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            style={styles.keyboardView}
          >
            {isEditing ? (
              <TextInput
                ref={inputRef}
                autoCapitalize="sentences"
                cursorColor={theme.accent}
                multiline
                onChangeText={handleMarkdownChange}
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
                ref={previewScrollRef}
                contentContainerStyle={styles.previewContent}
                keyboardShouldPersistTaps="handled"
                style={styles.preview}
              >
                <EnrichedMarkdownText
                  flavor="github"
                  markdown={
                    previewMarkdown.trim().length > 0 ? previewMarkdown : "Nothing to preview yet."
                  }
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

          {searchOpen && (
            <SearchOverlay
              error={searchError}
              inputRef={searchInputRef}
              nativeResults={searchResults}
              notes={notes}
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
        </View>
      </ReanimatedDrawerLayout>
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
  nativeResults: NoteSearchResponse;
  notes: MobileNoteMeta[];
  onChangeQuery: (query: string) => void;
  onClose: () => void;
  onOpenResult: (result: NoteSearchResult) => void;
  opacity: Animated.Value;
  query: string;
  scale: Animated.Value;
  searchState: SearchState;
  searching: boolean;
  theme: AppTheme;
  translateY: Animated.Value;
}) {
  const showNativeResults = query.trim().length > 0;
  const titleResults = showNativeResults ? nativeResults.title : notes.map(noteToTitleResult);
  const contentResults = showNativeResults ? nativeResults.content : [];
  const hasResults = titleResults.length > 0 || contentResults.length > 0;
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
          {hasResults && !error ? (
            <ScrollView
              contentContainerStyle={styles.searchResultList}
              keyboardShouldPersistTaps="handled"
              style={styles.searchResultScroll}
            >
              <SearchSectionLabel theme={theme}>
                {showNativeResults ? "Notes" : "Recent"}
              </SearchSectionLabel>
              {titleResults.map((result, index) => (
                <TitleSearchRow
                  key={result.id}
                  result={result}
                  selected={index === 0}
                  theme={theme}
                  onOpen={() => onOpenResult(result)}
                />
              ))}

              {showNativeResults && (
                <>
                  <SearchSectionLabel theme={theme}>Note content</SearchSectionLabel>
                  {contentResults.map((result, index) => (
                    <ContentSearchRow
                      key={result.id}
                      result={result}
                      selected={titleResults.length === 0 && index === 0}
                      theme={theme}
                      onOpen={() => onOpenResult(result)}
                    />
                  ))}
                </>
              )}
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

function SearchSectionLabel({ children, theme }: { children: string; theme: AppTheme }) {
  return <Text style={[styles.searchSectionLabel, { color: theme.textFaint }]}>{children}</Text>;
}

function TitleSearchRow({
  onOpen,
  result,
  selected,
  theme,
}: {
  onOpen: () => void;
  result: TitleSearchResult;
  selected: boolean;
  theme: AppTheme;
}) {
  return (
    <Pressable
      onPress={onOpen}
      style={({ pressed }) => [
        styles.searchResultRow,
        {
          backgroundColor: selected ? theme.active : "transparent",
          transform: [{ scale: pressed ? 0.985 : 1 }],
        },
      ]}
    >
      <Text numberOfLines={1} style={[styles.searchResultTitle, { color: theme.text }]}>
        {result.title}
      </Text>
    </Pressable>
  );
}

function ContentSearchRow({
  onOpen,
  result,
  selected,
  theme,
}: {
  onOpen: () => void;
  result: ContentSearchResult;
  selected: boolean;
  theme: AppTheme;
}) {
  const start = Math.max(0, Math.min(result.jump.matchStart, result.snippet.length));
  const end = Math.max(start, Math.min(result.jump.matchEnd, result.snippet.length));

  return (
    <Pressable
      onPress={onOpen}
      style={({ pressed }) => [
        styles.searchContentRow,
        {
          backgroundColor: selected ? theme.active : "transparent",
          transform: [{ scale: pressed ? 0.985 : 1 }],
        },
      ]}
    >
      <Text numberOfLines={1} style={[styles.searchResultTitle, { color: theme.text }]}>
        {result.title}
      </Text>
      <Text numberOfLines={2} style={[styles.searchSnippet, { color: theme.textFaint }]}>
        {result.snippet.slice(0, start)}
        <Text style={[styles.searchSnippetMatch, { color: theme.text }]}>
          {result.snippet.slice(start, end)}
        </Text>
        {result.snippet.slice(end)}
      </Text>
    </Pressable>
  );
}

function NotesPanel({
  activeNotePath,
  notes,
  onClose,
  onOpenNote,
  theme,
}: {
  activeNotePath: string | null;
  notes: MobileNoteMeta[];
  onClose: () => void;
  onOpenNote: (notePath: string) => void;
  theme: AppTheme;
}) {
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(() => new Set());
  const activeAncestors = useMemo(
    () => getAncestorDirectories(activeNotePath ?? ""),
    [activeNotePath],
  );
  const treeIndex = useMemo(() => createNoteTreeIndex(notes), [notes]);
  const rows = useMemo(
    () => createNoteTreeRows(treeIndex, collapsedFolders),
    [collapsedFolders, treeIndex],
  );
  const listExtraData = useMemo(
    () => ({ activeNotePath, collapsedFolders, theme }),
    [activeNotePath, collapsedFolders, theme],
  );

  useEffect(() => {
    if (activeAncestors.length === 0) return;

    setCollapsedFolders((current) => {
      let changed = false;
      const next = new Set(current);
      for (const folder of activeAncestors) {
        if (next.delete(folder)) changed = true;
      }
      return changed ? next : current;
    });
  }, [activeAncestors]);

  const toggleFolder = useCallback((folderPath: string) => {
    setCollapsedFolders((current) => {
      const next = new Set(current);
      if (next.has(folderPath)) {
        next.delete(folderPath);
      } else {
        next.add(folderPath);
      }
      return next;
    });
  }, []);
  const renderTreeRow = useCallback<ListRenderItem<NoteTreeRow>>(
    ({ item: row }) => (
      <NoteTreeRow
        active={row.kind === "note" && row.path === activeNotePath}
        collapsed={row.kind === "folder" && collapsedFolders.has(row.path)}
        row={row}
        theme={theme}
        onOpenNote={onOpenNote}
        onToggleFolder={toggleFolder}
      />
    ),
    [activeNotePath, collapsedFolders, onOpenNote, theme, toggleFolder],
  );

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

      <FlashList
        contentContainerStyle={styles.notesList}
        data={rows}
        extraData={listExtraData}
        getItemType={(row) => row.kind}
        keyExtractor={(row) => row.id}
        renderItem={renderTreeRow}
        style={styles.notesTree}
      />
    </View>
  );
}

const NoteTreeRow = React.memo(function NoteTreeRow({
  active,
  collapsed,
  onOpenNote,
  onToggleFolder,
  row,
  theme,
}: {
  active: boolean;
  collapsed: boolean;
  onOpenNote: (notePath: string) => void;
  onToggleFolder: (folderPath: string) => void;
  row: NoteTreeRow;
  theme: AppTheme;
}) {
  const rowColor = row.kind === "folder" ? theme.textSecondary : theme.text;
  const leftPadding = Spacing.three + row.depth * Spacing.three;

  if (row.kind === "folder") {
    return (
      <Pressable
        accessibilityLabel={`${collapsed ? "Expand" : "Collapse"} ${row.name}`}
        accessibilityRole="button"
        onPress={() => onToggleFolder(row.path)}
        style={[
          styles.treeRow,
          {
            backgroundColor: theme.background,
            borderBottomColor: theme.hairline,
            paddingLeft: leftPadding,
          },
        ]}
      >
        <View style={styles.folderGlyph}>
          <View style={[styles.folderGlyphTop, { backgroundColor: theme.textFaint }]} />
          <View style={[styles.folderGlyphBody, { borderColor: theme.textFaint }]} />
        </View>
        <Text numberOfLines={1} style={[styles.treeFolderText, { color: rowColor }]}>
          {row.name}
        </Text>
        <Text style={[styles.treeDisclosure, { color: theme.textFaint }]}>
          {collapsed ? "+" : "-"}
        </Text>
      </Pressable>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => onOpenNote(row.path)}
      style={[
        styles.treeRow,
        {
          backgroundColor: active ? theme.active : theme.background,
          borderBottomColor: theme.hairline,
          paddingLeft: leftPadding,
        },
      ]}
    >
      <View style={[styles.noteGlyph, { borderColor: active ? theme.accent : theme.textFaint }]} />
      <Text numberOfLines={1} style={[styles.treeNoteText, { color: rowColor }]}>
        {row.name}
      </Text>
    </Pressable>
  );
});

function createNoteTreeIndex(notes: MobileNoteMeta[]): NoteTreeIndex {
  const foldersByParent = new Map<string, Set<string>>();
  const notesByDirectory = new Map<string, MobileNoteMeta[]>();

  for (const note of notes) {
    const directory = normalizeTreePath(note.directory);
    const segments = directory ? directory.split("/") : [];
    let parentPath = "";

    for (const segment of segments) {
      const folderPath = joinVaultPath(parentPath, segment);
      const childFolders = foldersByParent.get(parentPath) ?? new Set<string>();
      childFolders.add(folderPath);
      foldersByParent.set(parentPath, childFolders);
      parentPath = folderPath;
    }

    const directoryNotes = notesByDirectory.get(directory) ?? [];
    directoryNotes.push(note);
    notesByDirectory.set(directory, directoryNotes);
  }

  return {
    foldersByParent: new Map(
      [...foldersByParent.entries()].map(([directoryPath, folders]) => [
        directoryPath,
        [...folders].sort(comparePathBasename),
      ]),
    ),
    notesByDirectory: new Map(
      [...notesByDirectory.entries()].map(([directoryPath, directoryNotes]) => [
        directoryPath,
        [...directoryNotes].sort(compareNotes),
      ]),
    ),
  };
}

function createNoteTreeRows(treeIndex: NoteTreeIndex, collapsedFolders: Set<string>) {
  const rows: NoteTreeRow[] = [];

  function appendDirectory(directoryPath: string, depth: number) {
    const folders = treeIndex.foldersByParent.get(directoryPath) ?? [];
    for (const folderPath of folders) {
      rows.push({
        depth,
        id: `folder:${folderPath}`,
        kind: "folder",
        name: getPathBasename(folderPath),
        path: folderPath,
      });

      if (!collapsedFolders.has(folderPath)) {
        appendDirectory(folderPath, depth + 1);
      }
    }

    const directoryNotes = treeIndex.notesByDirectory.get(directoryPath) ?? [];
    for (const note of directoryNotes) {
      rows.push({
        depth,
        id: `note:${note.path}`,
        kind: "note",
        name: note.title,
        note,
        path: note.path,
      });
    }
  }

  appendDirectory("", 0);
  return rows;
}

function getAncestorDirectories(notePath: string) {
  const segments = normalizeTreePath(notePath).split("/").filter(Boolean).slice(0, -1);
  const ancestors: string[] = [];

  for (const segment of segments) {
    ancestors.push(joinVaultPath(ancestors.at(-1) ?? "", segment));
  }

  return ancestors;
}

function compareNotes(left: MobileNoteMeta, right: MobileNoteMeta) {
  return left.title.localeCompare(right.title) || left.path.localeCompare(right.path);
}

function comparePathBasename(left: string, right: string) {
  return getPathBasename(left).localeCompare(getPathBasename(right)) || left.localeCompare(right);
}

function getPathBasename(path: string) {
  return path.split("/").at(-1) ?? path;
}

function normalizeTreePath(path: string) {
  return path
    .split(/[\\/]+/)
    .filter(Boolean)
    .join("/");
}

function joinVaultPath(...segments: string[]) {
  return segments.filter(Boolean).join("/");
}

function noteToTitleResult(note: MobileNoteMeta): TitleSearchResult {
  return {
    directory: note.directory,
    exact: false,
    id: `title:${note.path}`,
    notePath: note.path,
    title: note.title,
    type: "title",
  };
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
  contentHost: {
    flex: 1,
  },
  drawerLayout: {
    flex: 1,
  },
  keyboardView: {
    flex: 1,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
  },
  notesPanel: {
    borderRightWidth: 0,
    flex: 1,
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
  searchContentRow: {
    borderRadius: 2,
    gap: Spacing.half,
    paddingHorizontal: Spacing.three,
    paddingVertical: 9,
  },
  searchResultTitle: {
    fontFamily: Fonts.mono,
    fontSize: 12,
    lineHeight: 16,
  },
  searchSnippet: {
    fontFamily: Fonts.mono,
    fontSize: 11,
    lineHeight: 16,
  },
  searchSnippetMatch: {
    fontFamily: Fonts.mono,
    fontSize: 11,
    lineHeight: 16,
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
  notesTree: {
    flex: 1,
  },
  treeRow: {
    alignItems: "center",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: Spacing.two,
    height: 36,
    paddingRight: Spacing.three,
  },
  folderGlyph: {
    height: 14,
    width: 16,
  },
  folderGlyphTop: {
    borderRadius: 1,
    height: 3,
    left: 1,
    position: "absolute",
    top: 1,
    width: 8,
  },
  folderGlyphBody: {
    borderRadius: 2,
    borderWidth: 1.5,
    height: 10,
    left: 0,
    position: "absolute",
    top: 4,
    width: 16,
  },
  noteGlyph: {
    borderRadius: 1,
    borderWidth: 1.5,
    height: 15,
    width: 12,
  },
  treeFolderText: {
    flex: 1,
    fontFamily: Fonts.mono,
    fontSize: 12,
    lineHeight: 16,
  },
  treeNoteText: {
    flex: 1,
    fontFamily: Fonts.mono,
    fontSize: 12,
    lineHeight: 16,
  },
  treeDisclosure: {
    fontFamily: Fonts.mono,
    fontSize: 13,
    lineHeight: 16,
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
