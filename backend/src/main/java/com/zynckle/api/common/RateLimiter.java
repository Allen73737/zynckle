package com.zynckle.api.common;

import org.springframework.stereotype.Component;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/** Sliding-window limiter kept in memory; enough for a single API instance. */
@Component
public class RateLimiter {
    private final Map<String, Deque<Long>> windows = new ConcurrentHashMap<>();

    public void check(String key, int limit, long windowMs) {
        long now = System.currentTimeMillis();
        Deque<Long> window = windows.computeIfAbsent(key, k -> new ArrayDeque<>());
        synchronized (window) {
            while (!window.isEmpty() && now - window.peekFirst() > windowMs) window.pollFirst();
            if (window.size() >= limit) throw new ApiException(429, "Too many requests. Wait a moment and try again.");
            window.addLast(now);
        }
        if (windows.size() > 50_000) windows.entrySet().removeIf(e -> { synchronized (e.getValue()) { return e.getValue().isEmpty(); } });
    }
}
