import { useState, useCallback, useEffect, useRef } from "react";
import {
  apiGetConversations,
  apiCreateConversation,
  apiDeleteConversation,
  apiGetMessages,
  apiGetMySubmissions,
  type Conversation,
  type Message,
  type Submission,
} from "@/lib/api";

import { toast } from "./use-toast";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface Chat {
  id: number;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
}

const STORAGE_KEY = "chat_state";

function saveToStorage(chats: Chat[], activeChatId: number | null) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ chats, activeChatId }));
  } catch {}
}

function loadFromStorage(): { chats: Chat[]; activeChatId: number | null } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { chats: [], activeChatId: null };
    return JSON.parse(raw);
  } catch {
    return { chats: [], activeChatId: null };
  }
}

export function clearChatStorage() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

function toRole(role: string): "user" | "assistant" {
  const normalized = String(role).trim().toLowerCase();
  if (normalized === "assistant" || normalized === "ai" || normalized === "bot") {
    return "assistant";
  }
  return "user";
}

export function useChatManager() {
  const cached = loadFromStorage();
  const [chats, setChats] = useState<Chat[]>(cached.chats);
  const [activeChatId, setActiveChatId] = useState<number | null>(cached.activeChatId);
  const [isLoadingChats, setIsLoadingChats] = useState(true);

  const loadedPromiseRef = useRef<{ resolve: () => void } | null>(null);
  const loadedPromise = useRef<Promise<void>>(
    new Promise((res) => {
      loadedPromiseRef.current = { resolve: res };
    })
  );

  function persist(nextChats: Chat[], nextActiveId: number | null) {
    saveToStorage(nextChats, nextActiveId);
  }

  const loadConversations = useCallback(async () => {
    try {
      const conversations: Conversation[] = await apiGetConversations();
      
      const formattedChats = conversations.map((c) => ({
        id: c.id,
        title: c.title || "New Chat",
        messages: [],
        createdAt: c.created_at,
      }));

      setChats(formattedChats);

      if (formattedChats.length > 0 && !activeChatId) {
        const firstId = formattedChats[0].id;
        setActiveChatId(firstId);
        saveToStorage(formattedChats, firstId);
      } else if (formattedChats.length === 0) {
        setActiveChatId(null);
        saveToStorage([], null);
      }
    } catch (error) {
      console.error("Failed to load chats", error);
    } finally {
      setIsLoadingChats(false);
      loadedPromiseRef.current?.resolve();
    }
  }, [activeChatId]);

  useEffect(() => {
    loadConversations();
  }, []); // ← مهم: فقط مرة واحدة عند الـ mount

  const waitForLoad = useCallback(() => loadedPromise.current, []);

  const activeChatIdRef = useRef(activeChatId);
  const chatsRef = useRef(chats);
  useEffect(() => { activeChatIdRef.current = activeChatId; }, [activeChatId]);
  useEffect(() => { chatsRef.current = chats; }, [chats]);

  const activeChat = chats.find((c) => c.id === activeChatId) ?? null;

  // ====================== loadMessages (محسن) ======================
  // const loadMessages = useCallback(async (chatId: number) => {
  //   if (!chatId) return;

  //   try {
  //     const [messages, submissions]: [Message[], Submission[]] = await Promise.all([
  //       apiGetMessages(chatId),
  //       apiGetMySubmissions(),
  //     ]);

  //     setChats((prev) => {
  //       const existingChat = prev.find((c) => c.id === chatId);
  //       const existingMessages = existingChat?.messages ?? [];
  //       const existingAssistantMessages = existingMessages.filter(
  //         (msg) => msg.role === "assistant"
  //       );

  //       const normalizedUserMessages = messages.map((m) => ({
  //         role: toRole(m.role) as "user" | "assistant",
  //         content:
  //           m.role === "user" && m.code_content?.trim()
  //             ? m.code_content
  //             : m.content,
  //         timestamp: new Date(m.created_at).getTime(),
  //       }));

  //       const normalizedSubmissionMessages = submissions
  //         .filter((s) => {
  //           const asAny = s as Submission & { conversation_id?: number; chat_id?: number };
  //           return (
  //             asAny.conversation_id === chatId ||
  //             asAny.chat_id === chatId ||
  //             (asAny.conversation_id == null && asAny.chat_id == null)
  //           );
  //         })
  //         .map((s) => ({
  //           // Some backend versions expose submitted_at instead of created_at.
  //           // Keep compatibility while normalizing into one sortable timestamp.
  //           // eslint-disable-next-line @typescript-eslint/no-explicit-any
  //           _rawDate: ((s as any).created_at ?? (s as any).submitted_at) as string | undefined,
  //           role: "assistant" as const,
  //           content: `Analysis (${s.language}): ${s.status} (submission #${s.id})`,
  //           timestamp: 0,
  //         }))
  //         .map((s) => ({
  //           role: s.role,
  //           content: s.content,
  //           timestamp: Number.isFinite(new Date(s._rawDate ?? "").getTime())
  //             ? new Date(s._rawDate ?? "").getTime()
  //             : 0,
  //         }));

  //       const mergedSortedMessages: ChatMessage[] = [
  //         ...normalizedUserMessages,
  //         ...normalizedSubmissionMessages,
  //       ]
  //         .sort((a, b) => a.timestamp - b.timestamp)
  //         .map(({ role, content }) => ({ role, content }));

  //       const restoredHasAssistant = mergedSortedMessages.some(
  //         (msg) => msg.role === "assistant"
  //       );

  //       // If backend returns user-only history, keep previously cached assistant messages
  //       // so chat restoration does not drop existing AI responses.
  //       const mergedMessages =
  //         !restoredHasAssistant && existingAssistantMessages.length > 0
  //           ? [...mergedSortedMessages, ...existingAssistantMessages]
  //           : mergedSortedMessages;

  //       const next = prev.map((c) =>
  //         c.id === chatId
  //           ? {
  //               ...c,
  //               messages: mergedMessages,
  //             }
  //           : c
  //       );
  //       persist(next, activeChatIdRef.current ?? chatId);
  //       return next;
  //     });
  //   } catch (error) {
  //     console.error("Failed to load messages for chat", chatId, error);
  //   }
  // }, []);

//   const loadMessages = useCallback(async (chatId: number) => {
//   if (!chatId) return;

//   try {
//     // 1. استخدام Promise.allSettled لضمان عدم توقف العملية عند فشل أحد الطلبات
//     const results = await Promise.allSettled([
//       apiGetMessages(chatId),
//       apiGetMySubmissions(),
//     ]);

//     // استخراج النتائج بأمان؛ إذا فشل الطلب نستخدم مصفوفة فارغة كبديل
//     const messages = results[0].status === 'fulfilled' ? results[0].value : [];
//     const submissions = results[1].status === 'fulfilled' ? results[1].value : [];

//     // تسجيل الخطأ في الـ console للمتابعة إذا فشل استرجاع الـ AI
//     if (results[1].status === 'rejected') {
//       console.warn("AI Submissions could not be retrieved, showing user messages only.", results[1].reason);
//     }

//     setChats((prev) => {
//       const existingChat = prev.find((c) => c.id === chatId);
//       const existingMessages = existingChat?.messages ?? [];
//       const existingAssistantMessages = existingMessages.filter(
//         (msg) => msg.role === "assistant"
//       );

//       // 2. تنسيق رسائل المستخدم (User Messages)
//       const normalizedUserMessages = (messages as Message[]).map((m) => ({
//         role: toRole(m.role) as "user" | "assistant",
//         content:
//           m.role === "user" && m.code_content?.trim()
//             ? m.code_content
//             : m.content,
//         timestamp: new Date(m.created_at).getTime(),
//       }));

//       // 3. تنسيق ردود الـ AI القادمة من الـ Submissions
//       const normalizedSubmissionMessages = (submissions as Submission[])
//         .filter((s) => {
//           const asAny = s as Submission & { conversation_id?: number; chat_id?: number };
//           return (
//             asAny.conversation_id === chatId ||
//             asAny.chat_id === chatId ||
//             (asAny.conversation_id == null && asAny.chat_id == null)
//           );
//         })
//         .map((s) => {
//           // التعامل مع اختلاف مسميات الحقول في الـ Backend (created_at أو submitted_at)
//           const rawDate = (s as any).created_at ?? (s as any).submitted_at;
//           return {
//             role: "assistant" as const,
//             content: `Analysis (${s.language}): ${s.status} (submission #${s.id})`,
//             timestamp: Number.isFinite(new Date(rawDate ?? "").getTime())
//               ? new Date(rawDate ?? "").getTime()
//               : 0,
//           };
//         });

//       // 4. دمج المجموعتين وترتيبهما زمنياً
//       const mergedSortedMessages: ChatMessage[] = [
//         ...normalizedUserMessages,
//         ...normalizedSubmissionMessages,
//       ]
//         .sort((a, b) => a.timestamp - b.timestamp)
//         .map(({ role, content }) => ({ role, content }));

//       const restoredHasAssistant = mergedSortedMessages.some(
//         (msg) => msg.role === "assistant"
//       );

//       // في حال لم ننجح في استعادة ردود الـ AI، نحتفظ بما هو مخزن مؤقتاً (Cache)
//       const mergedMessages =
//         !restoredHasAssistant && existingAssistantMessages.length > 0
//           ? [...mergedSortedMessages, ...existingAssistantMessages]
//           : mergedSortedMessages;

//       const next = prev.map((c) =>
//         c.id === chatId
//           ? {
//               ...c,
//               messages: mergedMessages,
//             }
//           : c
//       );
//       persist(next, activeChatIdRef.current ?? chatId);
//       return next;
//     });
//   } catch (error) {
//     // هذا الجزء سيعمل فقط في حال حدوث خطأ برمجي داخل الـ try وليس عند فشل الـ API نفسه
//     console.error("Critical error in loadMessages logic", chatId, error);
//   }
// }, []);

const formatSubmissionAsMessage = (s: any): string => {
  const lines: string[] = [];
  
  // إذا كانت البيانات موجودة داخل حقل analysis أو بشكل مباشر في s
  const analysis = s.analysis || {};
  const score = s.efficiency_score || analysis.efficiency_score;
  const optimized = s.optimized_code || analysis.optimized_code;
  const suggestions = s.suggestions || analysis.suggestions;

  if (score !== undefined) {
    lines.push(`Efficiency Score: ${score}/100`);
  }
  
  // إضافة رسالة توضيحية أو الـ raw_output إذا وجد
  if (s.status === "completed" || s.status === "done") {
    lines.push("Mock analysis - AI integration pending");
  }

  if (optimized) {
    lines.push(`\nOptimized Code:\n${optimized}`);
  }

  if (suggestions) {
    if (Array.isArray(suggestions)) {
      lines.push(`\nSuggestions:\n${suggestions.map((sig: any) => `- ${sig}`).join("\n")}`);
    } else {
      lines.push(`\nSuggestions:\n- ${JSON.stringify(suggestions)}`);
    }
  }

  return lines.join("\n");
};

  const loadMessages = useCallback(async (chatId: number) => {
  if (!chatId) return;

  if (!window.navigator.onLine) {
    toast({
      variant: "destructive",
      title: "Connection Error",
      description: "Please check your internet connection and try again.",
    });
    return;
  }

  try {
    // 1. استخدام Promise.allSettled لضمان عدم توقف العملية عند فشل أحد الطلبات
    const results = await Promise.allSettled([
      apiGetMessages(chatId),
      apiGetMySubmissions(),
    ]);

    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        const isAiRequest = index === 1;
        const errorMessage = result.reason?.message || "Unknown error";
        
        // تنبيه مخصص حسب نوع الطلب الذي فشل
        toast({
          variant: "destructive",
          title: isAiRequest ? "AI Sync Issue" : "Message Sync Issue",
          description: errorMessage.includes("500") || errorMessage.includes("server")
            ? "The server is having trouble. We're showing what we can."
            : "Could not retrieve some messages. Please refresh.",
        });
      }
    });
    // استخراج النتائج بأمان؛ إذا فشل الطلب نستخدم مصفوفة فارغة كبديل
    const messages = results[0].status === 'fulfilled' ? results[0].value : [];
    const submissions = results[1].status === 'fulfilled' ? results[1].value : [];

    // تسجيل الخطأ في الـ console للمتابعة إذا فشل استرجاع الـ AI
    if (results[1].status === 'rejected') {
      console.warn("AI Submissions could not be retrieved, showing user messages only.", results[1].reason);
    }

    setChats((prev) => {
      const existingChat = prev.find((c) => c.id === chatId);
      const existingMessages = existingChat?.messages ?? [];
      const existingAssistantMessages = existingMessages.filter(
        (msg) => msg.role === "assistant"
      );

      // 2. تنسيق رسائل المستخدم (User Messages)
      const normalizedUserMessages = (messages as Message[]).map((m) => ({
        role: toRole(m.role) as "user" | "assistant",
        content:
          m.role === "user" && m.code_content?.trim()
            ? m.code_content
            : m.content,
        timestamp: new Date(m.created_at).getTime(),
      }));

      // 3. تنسيق ردود الـ AI القادمة من الـ Submissions
const normalizedSubmissionMessages = (submissions as Submission[])
  .filter((s) => {
    const asAny = s as any;
    return asAny.conversation_id === chatId || asAny.chat_id === chatId || (asAny.conversation_id == null && asAny.chat_id == null);
  })
  .map((s) => {
    const rawDate = (s as any).created_at ?? (s as any).submitted_at;
    return {
      role: "assistant" as const,
      // نستخدم الدالة الجديدة هنا بدلاً من النص الثابت القديم
      content: formatSubmissionAsMessage(s), 
      timestamp: new Date(rawDate ?? "").getTime() || 0,
    };
  });
      // 4. دمج المجموعتين وترتيبهما زمنياً
      const mergedSortedMessages: ChatMessage[] = [
        ...normalizedUserMessages,
        ...normalizedSubmissionMessages,
      ]
        .sort((a, b) => a.timestamp - b.timestamp)
        .map(({ role, content }) => ({ role, content }));

      const restoredHasAssistant = mergedSortedMessages.some(
        (msg) => msg.role === "assistant"
      );

      // في حال لم ننجح في استعادة ردود الـ AI، نحتفظ بما هو مخزن مؤقتاً (Cache)
      const mergedMessages =
        !restoredHasAssistant && existingAssistantMessages.length > 0
          ? [...mergedSortedMessages, ...existingAssistantMessages]
          : mergedSortedMessages;

      const next = prev.map((c) =>
        c.id === chatId
          ? {
              ...c,
              messages: mergedMessages,
            }
          : c
      );
      persist(next, activeChatIdRef.current ?? chatId);
      return next;
    });
  } catch (error) {
    // هذا الجزء سيعمل فقط في حال حدوث خطأ برمجي داخل الـ try وليس عند فشل الـ API نفسه
    console.error("Critical error in loadMessages logic", chatId, error);
  }
}, []);

  // ====================== setActiveChat (محسن) ======================
  const setActiveChat = useCallback(async (chatId: number) => {
    if (!chatId) return;

    setActiveChatId(chatId);

    // تحديث localStorage
    setChats((prev) => {
      persist(prev, chatId);
      return prev;
    });

    // حمل الرسائل مرة واحدة فقط
    await loadMessages(chatId);
  }, [loadMessages]);

  const createNewChat = useCallback(async (): Promise<number> => {
    const conversation = await apiCreateConversation("New Chat");
    const newChat: Chat = {
      id: conversation.id,
      title: conversation.title || "New Chat",
      messages: [],
      createdAt: conversation.created_at,
    };

    setChats((prev) => {
      const next = [newChat, ...prev];
      persist(next, newChat.id);
      return next;
    });

    setActiveChatId(newChat.id);
    // حمل الرسائل للشات الجديد (عادة بيكون فاضي)
    await loadMessages(newChat.id);

    return newChat.id;
  }, [loadMessages]);

  const getOrAssignChatId = useCallback(async (): Promise<number> => {
    await waitForLoad();
    const freshActiveId = activeChatIdRef.current;
    if (freshActiveId != null) return freshActiveId;

    const freshChats = chatsRef.current;
    if (freshChats.length > 0) {
      const id = freshChats[0].id;
      setActiveChatId(id);
      persist(freshChats, id);
      return id;
    }
    return createNewChat();
  }, [waitForLoad, createNewChat]);

  const addMessageToChat = useCallback((chatId: number, message: ChatMessage) => {
    setChats((prev) => {
      const next = prev.map((chat) => {
        if (chat.id !== chatId) return chat;
        const updatedMessages = [...chat.messages, message];
        const title =
          chat.messages.length === 0 && message.role === "user"
            ? message.content.trim().slice(0, 37) +
              (message.content.trim().length > 37 ? "..." : "")
            : chat.title;
        return { ...chat, messages: updatedMessages, title };
      });
      persist(next, chatId);
      return next;
    });
  }, []);

  const deleteChat = useCallback(
    async (chatId: number) => {
      try {
        await apiDeleteConversation(chatId);
      } catch {}
      
      setChats((prev) => {
        const filtered = prev.filter((c) => c.id !== chatId);
        const nextActive = activeChatId === chatId
          ? (filtered.length > 0 ? filtered[0].id : null)
          : activeChatId;
        
        setActiveChatId(nextActive);
        persist(filtered, nextActive);
        return filtered;
      });
    },
    [activeChatId]
  );

  // Always refresh active chat messages from server on chat switch.
  // This prevents stale localStorage state from hiding restored assistant replies.
  useEffect(() => {
    if (!activeChatId) return;
    loadMessages(activeChatId);
  }, [activeChatId, loadMessages]);

  return {
    chats,
    activeChatId,
    activeChat,
    isLoadingChats,
    createNewChat,
    setActiveChat,
    addMessageToChat,
    deleteChat,
    refreshChats: loadConversations,
    getOrAssignChatId,
  };
}