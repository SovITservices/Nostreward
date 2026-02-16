package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"slices"
	"sync"

	"github.com/fiatjaf/eventstore/sqlite3"
	"github.com/fiatjaf/khatru"
	"github.com/fsnotify/fsnotify"
	"github.com/nbd-wtf/go-nostr"
)

// WhitelistEntry matches the bot's whitelist.json format.
type WhitelistEntry struct {
	Pubkey  string `json:"pubkey"`
	AddedAt string `json:"addedAt"`
	Reason  string `json:"reason"`
}

// WhitelistFile is the top-level whitelist.json structure.
type WhitelistFile struct {
	Pubkeys []WhitelistEntry `json:"pubkeys"`
}

// Whitelist holds an in-memory set of allowed pubkeys with safe concurrent access.
type Whitelist struct {
	mu      sync.RWMutex
	pubkeys []string
}

func (w *Whitelist) Load(path string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			w.mu.Lock()
			w.pubkeys = nil
			w.mu.Unlock()
			return nil
		}
		return err
	}

	var file WhitelistFile
	if err := json.Unmarshal(data, &file); err != nil {
		return fmt.Errorf("parse whitelist: %w", err)
	}

	keys := make([]string, 0, len(file.Pubkeys))
	for _, entry := range file.Pubkeys {
		keys = append(keys, entry.Pubkey)
	}

	w.mu.Lock()
	w.pubkeys = keys
	w.mu.Unlock()

	log.Printf("whitelist loaded: %d pubkeys", len(keys))
	return nil
}

func (w *Whitelist) Contains(pubkey string) bool {
	w.mu.RLock()
	defer w.mu.RUnlock()
	return slices.Contains(w.pubkeys, pubkey)
}

func main() {
	botPubkey := os.Getenv("BOT_PUBKEY")
	if botPubkey == "" {
		log.Fatal("BOT_PUBKEY env var is required (hex pubkey of the bot)")
	}

	whitelistPath := os.Getenv("WHITELIST_FILE")
	if whitelistPath == "" {
		whitelistPath = "../whitelist.json"
	}

	dbPath := os.Getenv("DB_PATH")
	if dbPath == "" {
		dbPath = "relay.db"
	}

	listenAddr := os.Getenv("LISTEN_ADDR")
	if listenAddr == "" {
		listenAddr = ":3334"
	}

	// Load whitelist
	wl := &Whitelist{}
	if err := wl.Load(whitelistPath); err != nil {
		log.Fatal("failed to load whitelist: ", err)
	}

	// Watch whitelist for changes
	go watchWhitelist(whitelistPath, wl)

	// isAllowed checks if a pubkey is the bot or on the whitelist
	isAllowed := func(pubkey string) bool {
		return pubkey == botPubkey || wl.Contains(pubkey)
	}

	// Set up relay
	relay := khatru.NewRelay()
	relay.Info.Name = "Nostreward Private Relay"
	relay.Info.Description = "Private relay for Nostreward product offers. Auth required."
	relay.Info.Software = "khatru"

	// SQLite storage
	db := sqlite3.SQLite3Backend{DatabaseURL: dbPath}
	if err := db.Init(); err != nil {
		log.Fatal("failed to init database: ", err)
	}

	relay.StoreEvent = append(relay.StoreEvent, db.SaveEvent)
	relay.QueryEvents = append(relay.QueryEvents, db.QueryEvents)
	relay.CountEvents = append(relay.CountEvents, db.CountEvents)
	relay.DeleteEvent = append(relay.DeleteEvent, db.DeleteEvent)
	relay.ReplaceEvent = append(relay.ReplaceEvent, db.ReplaceEvent)

	// Request AUTH on every new connection
	relay.OnConnect = append(relay.OnConnect, func(ctx context.Context) {
		khatru.RequestAuth(ctx)
	})

	// Write access: reject events from unauthenticated or non-whitelisted users
	relay.RejectEvent = append(relay.RejectEvent,
		func(ctx context.Context, event *nostr.Event) (bool, string) {
			authed := khatru.GetAuthed(ctx)
			if authed == "" {
				return true, "auth-required: you must authenticate to publish"
			}
			if !isAllowed(authed) {
				return true, "restricted: your pubkey is not whitelisted"
			}
			return false, ""
		},
	)

	// Read access: reject filters from unauthenticated or non-whitelisted users
	relay.RejectFilter = append(relay.RejectFilter,
		func(ctx context.Context, filter nostr.Filter) (bool, string) {
			authed := khatru.GetAuthed(ctx)
			if authed == "" {
				return true, "auth-required: you must authenticate to read"
			}
			if !isAllowed(authed) {
				return true, "restricted: your pubkey is not whitelisted"
			}
			return false, ""
		},
	)

	log.Printf("starting private relay on %s", listenAddr)
	if err := http.ListenAndServe(listenAddr, relay); err != nil {
		log.Fatal(err)
	}
}

func watchWhitelist(path string, wl *Whitelist) {
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		log.Printf("warning: could not watch whitelist file: %v", err)
		return
	}
	defer watcher.Close()

	if err := watcher.Add(path); err != nil {
		log.Printf("warning: could not watch %s: %v", path, err)
		return
	}

	log.Printf("watching %s for changes", path)
	for {
		select {
		case event, ok := <-watcher.Events:
			if !ok {
				return
			}
			if event.Op&(fsnotify.Write|fsnotify.Create) != 0 {
				if err := wl.Load(path); err != nil {
					log.Printf("error reloading whitelist: %v", err)
				}
			}
		case err, ok := <-watcher.Errors:
			if !ok {
				return
			}
			log.Printf("whitelist watcher error: %v", err)
		}
	}
}
