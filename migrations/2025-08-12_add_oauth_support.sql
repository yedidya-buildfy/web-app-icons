-- Migration: Add OAuth support for user profiles
-- This migration extends the auth.users table with a profiles table for OAuth metadata

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create profiles table to store additional user metadata from OAuth providers
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email TEXT,
  full_name TEXT,
  avatar_url TEXT,
  provider TEXT, -- 'google', 'github', 'email', etc.
  provider_id TEXT, -- The ID from the OAuth provider
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS (Row Level Security)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can view own profile"
  ON public.profiles
  FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON public.profiles
  FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON public.profiles
  FOR INSERT
  WITH CHECK (auth.uid() = id);

-- Create function to handle new user registrations (both OAuth and email)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (
    id,
    email,
    full_name,
    avatar_url,
    provider,
    provider_id
  ) VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'),
    COALESCE(NEW.raw_user_meta_data->>'avatar_url', NEW.raw_user_meta_data->>'picture'),
    COALESCE(NEW.raw_app_meta_data->>'provider', 'email'),
    NEW.raw_user_meta_data->>'provider_id'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger to automatically create profile on user signup
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- Update function to handle profile updates
CREATE OR REPLACE FUNCTION public.handle_user_update()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.profiles SET
    email = NEW.email,
    full_name = COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', full_name),
    avatar_url = COALESCE(NEW.raw_user_meta_data->>'avatar_url', NEW.raw_user_meta_data->>'picture', avatar_url),
    updated_at = NOW()
  WHERE id = NEW.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger to automatically update profile when user data changes
DROP TRIGGER IF EXISTS on_auth_user_updated ON auth.users;
CREATE TRIGGER on_auth_user_updated
  AFTER UPDATE ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_user_update();

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_profiles_provider ON public.profiles(provider);
CREATE INDEX IF NOT EXISTS idx_profiles_provider_id ON public.profiles(provider_id);
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);

-- Add user_id columns to existing tables if they don't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'searches' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE public.searches ADD COLUMN user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'generated_icons' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE public.generated_icons ADD COLUMN user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Add foreign key constraints if they don't exist (columns should exist now)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE table_name = 'searches' AND constraint_name = 'searches_user_id_fkey'
  ) THEN
    -- Only add constraint if column exists but constraint doesn't
    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'searches' AND column_name = 'user_id'
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'searches_user_id_fkey'
    ) THEN
      ALTER TABLE public.searches 
      ADD CONSTRAINT searches_user_id_fkey 
      FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
    END IF;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE table_name = 'generated_icons' AND constraint_name = 'generated_icons_user_id_fkey'
  ) THEN
    -- Only add constraint if column exists but constraint doesn't
    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'generated_icons' AND column_name = 'user_id'
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'generated_icons_user_id_fkey'
    ) THEN
      ALTER TABLE public.generated_icons 
      ADD CONSTRAINT generated_icons_user_id_fkey 
      FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
    END IF;
  END IF;
END $$;