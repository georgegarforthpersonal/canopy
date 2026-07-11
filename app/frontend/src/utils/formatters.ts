/**
 * Formatting Utilities
 *
 * Shared utility functions for formatting data across the application.
 */

import type { Surveyor } from '../services/api';

/**
 * A surveyor's full display name (first + last, last optional).
 */
export const surveyorFullName = (s: Pick<Surveyor, 'first_name' | 'last_name'>): string =>
  s.last_name ? `${s.first_name} ${s.last_name}` : s.first_name;

/**
 * Get surveyor's full name from a list of surveyors by ID.
 *
 * @param id - Surveyor ID to look up
 * @param surveyors - List of surveyors to search
 * @returns Full name (first + last) or "Unknown" if not found
 */
export const getSurveyorName = (id: number, surveyors: Surveyor[]): string => {
  const surveyor = surveyors.find(s => s.id === id);
  return surveyor ? surveyorFullName(surveyor) : 'Unknown';
};

/**
 * Extract initials from a full name.
 *
 * @param name - Full name to extract initials from
 * @returns Initials (e.g., "John Smith" → "JS", "Jane" → "J")
 *
 * @example
 * getInitials("John Smith") // "JS"
 * getInitials("Jane") // "J"
 * getInitials("") // "?"
 */
export const getInitials = (name: string): string => {
  const parts = name.trim().split(' ').filter(p => p.length > 0);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  if (parts.length === 1 && parts[0].length > 0) {
    return parts[0][0].toUpperCase();
  }
  return '?';
};

/**
 * Format a date string to a readable format.
 *
 * @param dateStr - Date string in ISO format (YYYY-MM-DD)
 * @returns Formatted date string (e.g., "Jan 15, 2024")
 *
 * @example
 * formatDate("2024-01-15") // "Jan 15, 2024"
 */
export const formatDate = (dateStr: string): string => {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

/**
 * Format a time string to 12-hour format.
 *
 * @param timeStr - Time string in HH:MM:SS or HH:MM format
 * @returns Formatted time string (e.g., "2:30 PM")
 */
export const formatTime = (timeStr: string | null | undefined): string => {
  if (!timeStr) return '';
  const [hours, minutes] = timeStr.split(':').map(Number);
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const hour12 = hours % 12 || 12;
  return `${hour12}:${minutes.toString().padStart(2, '0')} ${ampm}`;
};

/**
 * Format a number with thousands separators.
 *
 * @param num - Number to format
 * @returns Formatted number string (e.g., 1234567 → "1,234,567")
 */
export const formatNumber = (num: number): string => {
  return num.toLocaleString('en-US');
};
