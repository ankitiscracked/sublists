on run argv
  set noteID to item 1 of argv
  set imagePath to item 2 of argv
  tell application "Notes"
    set targetNote to first note whose id is noteID
    if (count attachments of targetNote) is 0 then
      set imageFile to POSIX file imagePath as alias
      make new attachment at end of attachments of targetNote with data imageFile
    end if
    -- Notes can insert the same image reference twice. Only repair our exact pair.
    if (count attachments of targetNote) is 2 then
      set firstImage to attachment 1 of targetNote
      set secondImage to attachment 2 of targetNote
      if (id of firstImage) is (id of secondImage) and (name of firstImage) is "thumbnail.jpg" then
        delete attachment 2 of targetNote
      end if
    end if
    return count attachments of targetNote
  end tell
end run
